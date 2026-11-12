// Account state and story sync for the logged-in user. When no one is signed in
// — the common path while Vipps is still being set up — every call falls back
// to the local IndexedDB store, so the app keeps working as it did before.
import { AGE_GROUPS, ART_STYLES, DURATIONS, SavedStory, StoryOptions } from "../types";
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
    };
  } catch {
    return null;
  }
}

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
    };
    const status: AccountStatus = {
      checked: true,
      vippsReady: Boolean(data.vippsKlar),
      supabaseReady: Boolean(data.supabaseKlar),
      innlogget: Boolean(data.innlogget),
      fornavn: data.fornavn || "",
      valg: cleanPreferences(data.valg),
    };
    cacheStatus(status);
    return status;
  } catch {
    return fallback();
  } finally {
    clearTimeout(timer);
  }
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
