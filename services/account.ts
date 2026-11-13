// Account state and story sync for the logged-in user. When no one is signed in
// — the common path while Vipps is still being set up — every call falls back
// to the local IndexedDB store, so the app keeps working as it did before.
import { AGE_GROUPS, ART_STYLES, DURATIONS, Plan, SavedStory, StoryOptions } from "../types";
import {
  deleteStoryFromDB,
  getAllStoriesFromDB,
  saveStoryToDB,
} from "./storage";

export interface AccountStatus {
  // The server's /api/meg has answered at least once.
  checked: boolean;
  // /api/vipps/start will actually work (env vars in place).
  vippsReady: boolean;
  // Supabase is reachable, so stories can be synced for the logged-in user.
  supabaseReady: boolean;
  innlogget: boolean;
  fornavn: string;
  // Setup choices saved on the account (age group, reading length, drawing style).
  valg: SetupPreferences;
  // Gratis or Pro; null until the user has chosen (the plan page is shown).
  plan: Plan | null;
  // Free stories left this week (a «Magihistorie» needs them all). null on
  // Pro (no limit) or when unknown.
  freeLeft: number | null;
  // Single stories / Prinsen can be bought with Vipps.
  canBuy: boolean;
  canSubscribe: boolean;
  // Bought stories not yet made.
  credits: StoryCredits;
  // The Prinsen subscription paid with Vipps, if there is one.
  subscription: Subscription | null;
}

export interface StoryCredits {
  plain: number;
  personal: number;
}

export interface Subscription {
  // stoppet: cancelled, Prinsen lasts until paidUntil.
  status: "aktiv" | "stoppet";
  // YYYY-MM-DD: the next charge (aktiv) or the last day (stoppet).
  paidUntil: string;
}

const count = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;

function cleanCredits(raw: unknown): StoryCredits {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { plain: count(r.plain ?? r.historie), personal: count(r.personal ?? r.dinHistorie) };
}

function cleanSubscription(raw: unknown): Subscription | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const paidUntil = r.paidUntil ?? r.betaltTil;
  if ((r.status !== "aktiv" && r.status !== "stoppet") || typeof paidUntil !== "string") return null;
  return { status: r.status, paidUntil };
}

// The setup choices we remember between visits.
export type SetupPreferences = Partial<Pick<StoryOptions, "ageGroup" | "duration" | "artStyle">>;

const STATUS_KEY = "magiboka_konto";
const PREFS_KEY = "magiboka_valg";

function cleanPreferences(raw: unknown): SetupPreferences {
  const out: SetupPreferences = {};
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  if (typeof r.ageGroup === "string" && AGE_GROUPS.includes(r.ageGroup)) out.ageGroup = r.ageGroup;
  if (typeof r.duration === "string" && DURATIONS.includes(r.duration)) out.duration = r.duration;
  if (typeof r.artStyle === "string" && ART_STYLES.includes(r.artStyle)) out.artStyle = r.artStyle;
  return out;
}

// This browser's own copy of the choices. Works for guests too.
export function loadLocalPreferences(): SetupPreferences {
  try {
    return cleanPreferences(JSON.parse(localStorage.getItem(PREFS_KEY) || "{}"));
  } catch {
    return {};
  }
}

// Remember the choices here, and on the account when logged in. Resolves
// to where they ended up, so the page can say so.
export async function rememberPreferences(
  preferences: SetupPreferences,
  innlogget: boolean
): Promise<"local" | "account" | "account-failed"> {
  const valg = cleanPreferences(preferences);
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(valg));
  } catch {
    // Private mode — the choices just won't survive a reload.
  }
  if (!innlogget) return "local";
  try {
    const r = await fetch("/api/meg", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ valg }),
    });
    return r.ok ? "account" : "account-failed";
  } catch {
    return "account-failed";
  }
}

// What /api/meg answered last time in this browser. Lets the page show the
// user as logged in at once, and keeps them logged in on screen when the
// server is slow to answer.
function cachedStatus(): AccountStatus | null {
  try {
    const raw = JSON.parse(localStorage.getItem(STATUS_KEY) || "null");
    if (!raw || typeof raw !== "object") return null;
    return {
      checked: false,
      vippsReady: Boolean(raw.vippsReady),
      supabaseReady: Boolean(raw.supabaseReady),
      innlogget: Boolean(raw.innlogget),
      fornavn: typeof raw.fornavn === "string" ? raw.fornavn : "",
      valg: cleanPreferences(raw.valg),
      plan: cleanPlan(raw.plan),
      freeLeft: typeof raw.freeLeft === "number" ? raw.freeLeft : null,
      canBuy: Boolean(raw.canBuy),
      canSubscribe: Boolean(raw.canSubscribe),
      credits: cleanCredits(raw.credits),
      subscription: cleanSubscription(raw.subscription),
    };
  } catch {
    return null;
  }
}

const cleanPlan = (raw: unknown): Plan | null =>
  raw === "pro" || raw === "gratis" ? raw : null;

function cacheStatus(status: AccountStatus | null): void {
  try {
    if (status) localStorage.setItem(STATUS_KEY, JSON.stringify(status));
    else localStorage.removeItem(STATUS_KEY);
  } catch {
    // ignore
  }
}

// First render: the last known state, before the server has answered.
export const initialStatus = (): AccountStatus => cachedStatus() ?? emptyStatus();

export const emptyStatus = (): AccountStatus => ({
  checked: false,
  vippsReady: false,
  supabaseReady: false,
  innlogget: false,
  fornavn: "",
  valg: {},
  plan: null,
  freeLeft: null,
  canBuy: false,
  canSubscribe: false,
  credits: { plain: 0, personal: 0 },
  subscription: null,
});

// /api/meg is slow (cold start) or down when env vars are missing, so we
// time it out instead of leaving the UI stuck. If it doesn't answer we keep
// what it said last time — a slow server must not look like a logout.
export async function fetchStatus(timeoutMs = 6000): Promise<AccountStatus> {
  const fallback = (): AccountStatus => ({
    ...(cachedStatus() ?? emptyStatus()),
    checked: true,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch("/api/meg", {
      credentials: "same-origin",
      signal: controller.signal,
    });
    if (!r.ok) return fallback();
    const data = (await r.json()) as {
      vippsKlar?: boolean;
      supabaseKlar?: boolean;
      innlogget?: boolean;
      fornavn?: string;
      valg?: unknown;
      plan?: unknown;
      gratisIgjen?: unknown;
      kjopKlar?: boolean;
      abonnementKlar?: boolean;
      tilGode?: unknown;
      abonnement?: unknown;
    };
    const status: AccountStatus = {
      checked: true,
      vippsReady: Boolean(data.vippsKlar),
      supabaseReady: Boolean(data.supabaseKlar),
      innlogget: Boolean(data.innlogget),
      fornavn: data.fornavn || "",
      valg: cleanPreferences(data.valg),
      plan: cleanPlan(data.plan),
      freeLeft: typeof data.gratisIgjen === "number" ? data.gratisIgjen : null,
      canBuy: Boolean(data.kjopKlar),
      canSubscribe: Boolean(data.abonnementKlar),
      credits: cleanCredits(data.tilGode),
      subscription: cleanSubscription(data.abonnement),
    };
    cacheStatus(status);
    return status;
  } catch {
    return fallback();
  } finally {
    clearTimeout(timer);
  }
}

// Keep the cached copy in step when the plan changes in this browser.
export function rememberStatus(status: AccountStatus): void {
  cacheStatus(status);
}

// Pick the free plan. False if it could not be saved.
export async function chooseFreePlan(): Promise<boolean> {
  try {
    const r = await fetch("/api/meg", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: "gratis" }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

// A share link that gives Prinsen looks like /?prinsen=<key>. The key is
// taken out of the address at once (before the page view is measured) and
// kept in this browser until it has been used — which needs a login.
const LINK_PARAM = "prinsen";
const LINK_KEY = "magiboka_lenke";

export function captureShareLink(): void {
  try {
    const params = new URLSearchParams(window.location.search);
    const key = params.get(LINK_PARAM);
    if (key === null) return;
    params.delete(LINK_PARAM);
    window.history.replaceState(
      null,
      "",
      window.location.pathname +
        (params.toString() ? `?${params.toString()}` : "") +
        window.location.hash
    );
    if (key.trim()) localStorage.setItem(LINK_KEY, key.trim().slice(0, 64));
  } catch {
    // Private mode — the link only works if the visitor is already logged in.
  }
}

export function pendingShareLink(): string | null {
  try {
    return localStorage.getItem(LINK_KEY);
  } catch {
    return null;
  }
}

export function forgetShareLink(): void {
  try {
    localStorage.removeItem(LINK_KEY);
  } catch {
    // ignore
  }
}

// Use a share link: "ok" (the account is Prinsen now), "login" (the link is
// good — log in to use it), "wrong" (not a valid link) or "error".
export async function redeemShareLink(
  key: string
): Promise<"ok" | "login" | "wrong" | "error"> {
  try {
    const r = await fetch("/api/meg", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lenke: key }),
    });
    if (r.ok) return "ok";
    if (r.status === 401) return "login";
    return r.status === 400 ? "wrong" : "error";
  } catch {
    return "error";
  }
}

// Read on in a story that was started before logging in. On the free plan
// it becomes this week's free story: "used" when that one is already gone.
// "bought": it was paid for with a bought story instead.
export async function claimGuestStory(): Promise<"ok" | "bought" | "used" | "login" | "error"> {
  try {
    const r = await fetch("/api/meg", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gjestehistorie: true }),
    });
    if (r.status === 200) return "bought";
    if (r.ok) return "ok";
    if (r.status === 429) return "used";
    return r.status === 401 ? "login" : "error";
  } catch {
    return "error";
  }
}

// ---- Payment with Vipps (api/betaling.ts) ----------------------------------

async function postPayment<T>(body: unknown): Promise<T> {
  const r = await fetch("/api/betaling", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(data.error || "Noe gikk galt. Prøv igjen om litt.");
  return data;
}

// The story to make once it is paid for. Kept in this browser while the
// buyer is at Vipps.
export interface StoryOrder {
  options: StoryOptions;
  personal: boolean;
}
const ORDER_KEY = "magiboka_bestilling";
const ORDER_MAX_AGE_MS = 2 * 60 * 60 * 1000;

// Go to Vipps to pay for one story. Only returns if that failed (throws).
export async function buyStory(order: StoryOrder): Promise<void> {
  const { url } = await postPayment<{ url: string }>({
    kjop: order.personal ? "din-historie" : "historie",
  });
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify({ ...order, savedAt: Date.now() }));
  } catch {
    // Private mode — the story is still paid for, it just has to be picked again.
  }
  window.location.href = url;
}

// The story that was being bought, once.
export function takeStoryOrder(): StoryOrder | null {
  try {
    const raw = JSON.parse(localStorage.getItem(ORDER_KEY) || "null");
    localStorage.removeItem(ORDER_KEY);
    if (
      raw &&
      typeof raw === "object" &&
      raw.options &&
      typeof raw.options === "object" &&
      typeof raw.savedAt === "number" &&
      Date.now() - raw.savedAt < ORDER_MAX_AGE_MS
    ) {
      return { options: raw.options as StoryOptions, personal: raw.personal === true };
    }
  } catch {
    // Nothing usable stored.
  }
  return null;
}

// Go to Vipps to approve the Prinsen agreement. Throws if that failed.
export async function subscribe(): Promise<void> {
  const { url } = await postPayment<{ url: string }>({ abonner: true });
  window.location.href = url;
}

// Cancel Prinsen. Resolves to the last day it lasts (YYYY-MM-DD).
export async function cancelSubscription(): Promise<string> {
  return (await postPayment<{ betaltTil: string }>({ stopp: true })).betaltTil;
}

// Vipps sends the buyer back to /?betalt=<reference> (one story) or
// /?avtale=<reference> (Prinsen). The reference is taken out of the address
// at once, before the page view is measured.
export interface PaymentReturn {
  kind: "kjop" | "avtale";
  reference: string;
}
let paymentReturn: PaymentReturn | null = null;

export function capturePaymentReturn(): void {
  try {
    const params = new URLSearchParams(window.location.search);
    const bought = params.get("betalt");
    const agreed = params.get("avtale");
    if (bought === null && agreed === null) return;
    paymentReturn = bought
      ? { kind: "kjop", reference: bought }
      : agreed
        ? { kind: "avtale", reference: agreed }
        : null;
    params.delete("betalt");
    params.delete("avtale");
    window.history.replaceState(
      null,
      "",
      window.location.pathname +
        (params.toString() ? `?${params.toString()}` : "") +
        window.location.hash
    );
  } catch {
    // ignore
  }
}

const WAITING_KEY = "magiboka_betaling_venter";

// The payment to ask about on this load: the one in the address, or one
// that could not be settled last time.
export function takePaymentReturn(): PaymentReturn | null {
  let r = paymentReturn;
  paymentReturn = null;
  try {
    const waiting = JSON.parse(localStorage.getItem(WAITING_KEY) || "null");
    localStorage.removeItem(WAITING_KEY);
    if (
      !r &&
      waiting &&
      (waiting.kind === "kjop" || waiting.kind === "avtale") &&
      typeof waiting.reference === "string" &&
      typeof waiting.savedAt === "number" &&
      Date.now() - waiting.savedAt < 24 * 60 * 60 * 1000
    ) {
      r = { kind: waiting.kind, reference: waiting.reference };
    }
  } catch {
    // ignore
  }
  return r;
}

// Ask again on the next visit.
export function keepPaymentReturn(back: PaymentReturn): void {
  try {
    localStorage.setItem(WAITING_KEY, JSON.stringify({ ...back, savedAt: Date.now() }));
  } catch {
    // ignore
  }
}

export interface PaymentResult {
  // paid: the money is taken / the agreement runs. cancelled: nothing was
  // paid. pending: Vipps hasn't said yet. error: could not be checked.
  status: "paid" | "cancelled" | "pending" | "error";
  // It belongs to the account logged in here.
  mine: boolean;
  personal: boolean;
}

// Ask the server how the payment went. Vipps can take a few seconds to
// settle, so "not yet" is asked again for a while.
export async function confirmPayment(back: PaymentReturn): Promise<PaymentResult> {
  const result: PaymentResult = { status: "pending", mine: false, personal: false };
  for (let attempt = 0; attempt < 10; attempt++) {
    if (attempt > 0) await new Promise((resolve) => window.setTimeout(resolve, 1500));
    try {
      const data = await postPayment<{ status?: string; type?: string; min?: boolean }>({
        bekreft: back.reference,
        slag: back.kind,
      });
      result.mine = Boolean(data.min);
      result.personal = data.type === "din-historie";
      if (data.status === "betalt" || data.status === "aktiv") return { ...result, status: "paid" };
      if (data.status === "avbrutt" || data.status === "ukjent") {
        return { ...result, status: "cancelled" };
      }
      result.status = data.status === "venter" ? "pending" : "error";
    } catch {
      result.status = "error";
    }
  }
  return result;
}

export async function logout(): Promise<void> {
  cacheStatus(null);
  try {
    await fetch("/api/loggut", {
      method: "POST",
      credentials: "same-origin",
    });
  } catch {
    // Ignore — the cookie expires on its own eventually.
  }
}

// Load every story the user has. Logged in → Supabase (and we migrate any
// IndexedDB leftovers up on the way in). Logged out → IndexedDB.
export async function loadStories(innlogget: boolean): Promise<SavedStory[]> {
  if (!innlogget) return getAllStoriesFromDB();
  // One-shot migration: any story still sitting in IndexedDB after login
  // gets pushed to Supabase and removed locally, so stories don't appear
  // or disappear depending on which browser the user is on.
  try {
    const local = await getAllStoriesFromDB();
    for (const s of local) {
      const ok = await saveStoryRemote(s);
      if (ok) await deleteStoryFromDB(s.id);
    }
  } catch (err) {
    console.warn("Kunne ikke flytte lokale historier til kontoen:", err);
  }
  const r = await fetch("/api/stories", { credentials: "same-origin" });
  if (!r.ok) return [];
  const list = (await r.json()) as SavedStory[];
  return list.sort((a, b) => b.createdAt - a.createdAt);
}

// Re-encode an illustration as JPEG, capped at 1280 px. Gemini returns PNGs
// of 1.5–2 MB; as JPEG they are a tenth of that, which makes saving fast on
// mobile and keeps every upload far under Vercel's 4.5 MB request limit.
// Falls back to the original if the browser can't do it or it isn't smaller.
export async function compressImage(dataUrl: string): Promise<string> {
  try {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const scale = Math.min(
      1,
      1280 / Math.max(img.naturalWidth, img.naturalHeight)
    );
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    // JPEG has no transparency — paint white underneath, like a book page.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const jpeg = canvas.toDataURL("image/jpeg", 0.85);
    return jpeg.startsWith("data:image/jpeg") && jpeg.length < dataUrl.length
      ? jpeg
      : dataUrl;
  } catch {
    return dataUrl;
  }
}

// Each illustration goes up on its own (/api/bilde), then the story is saved
// as text with a storage key per page. A whole story with inline images is
// ~10 MB and Vercel rejects anything over 4.5 MB.
async function saveStoryRemote(story: SavedStory): Promise<boolean> {
  try {
    const segments = await Promise.all(
      story.segments.map(async (seg, idx) => {
        const { imageBase64, ...rest } = seg;
        // Already in storage (a story loaded from the account and saved
        // again): keep the key, drop the signed URL.
        if (!imageBase64 || !imageBase64.startsWith("data:")) return rest;
        const key = `side-${idx}`;
        const r = await fetch("/api/bilde", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storyId: story.id,
            key,
            bilde: await compressImage(imageBase64),
          }),
        });
        if (!r.ok) throw new Error(`bilde ${idx + 1}: HTTP ${r.status}`);
        return { ...rest, imageKey: key };
      })
    );
    const plan = story.plan
      ? (({ characterSheetBase64: _sheet, ...p }) => p)(story.plan)
      : undefined;
    const r = await fetch("/api/stories", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...story, segments, plan }),
    });
    if (!r.ok) throw new Error(`historien: HTTP ${r.status}`);
    return true;
  } catch (err) {
    console.warn("Kunne ikke lagre eventyret til kontoen:", err);
    return false;
  }
}

export async function saveStory(
  story: SavedStory,
  innlogget: boolean
): Promise<boolean> {
  if (!innlogget) {
    await saveStoryToDB(story);
    return true;
  }
  const ok = await saveStoryRemote(story);
  // Mirror locally, so the story is still there if the user goes offline or
  // signs out later.
  if (ok) {
    try {
      await saveStoryToDB(story);
    } catch {
      // Not fatal — the server has it.
    }
  }
  return ok;
}

export async function deleteStory(
  id: string,
  innlogget: boolean
): Promise<boolean> {
  // Always clear the local copy so the UI is consistent across sign-out.
  try {
    await deleteStoryFromDB(id);
  } catch {
    // Ignore — if it wasn't there, that's fine.
  }
  if (!innlogget) return true;
  const r = await fetch(`/api/stories?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  return r.ok;
}
