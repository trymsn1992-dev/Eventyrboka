// Who may do what, and what it costs. Everything that costs something costs
// one wish («ønske»): a story, a new hero drawn from a photo, a new moral of
// your own, and read-aloud of a story. A visitor without a login gets one
// plain story, once. Everything is checked here on the server — the browser
// only shows the numbers.
//
// Wishes: Askeladden gets 2 every week and Prinsen 8 (see types.ts). They are
// counted per account in Supabase (bruk_onsker in supabase/schema.sql): the
// week's first, then bought ones.
import { createHash, timingSafeEqual } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { openCookie, readSession, sealCookie, type Session } from "./session.js";
import { callRpc, getAccount, quotaRpc, supabaseReady, tableRequest } from "./supabase.js";
import {
  ART_STYLES,
  DEFAULT_ART_STYLE,
  METAPHORS,
  WISHES_PER_WEEK,
  type Plan,
} from "../../types.js";

// Answers 401 and returns null when nobody is logged in.
export function requireLogin(
  req: VercelRequest,
  res: VercelResponse
): Session | null {
  const session = readSession(req);
  if (!session) {
    res.status(401).json({ error: "Du må logge inn for å gjøre dette." });
    return null;
  }
  return session;
}

export async function isPro(vippsSub: string): Promise<boolean> {
  return (await getAccount(vippsSub)).plan === "pro";
}

// Share links that give Prinsen: https://www.magiboka.no/?prinsen=<key>.
// Whoever opens one and logs in is Prinsen through the day in `til`, and
// Askeladden after that. Only the SHA-256 of each key is kept here. Remove a
// line to stop that link from working (those who already used it keep
// Prinsen until their day); add a line to make a new link:
//   KEY=$(openssl rand -hex 16); echo $KEY; printf '%s' $KEY | shasum -a 256
const PRO_LINKS: Array<{ sha256: string; til: string }> = [
  { sha256: "006294f962830c59bd66229f6a50dbec03c776e821011048e45912bba8596fbb", til: "2026-12-31" },
];

// The day the link gives Prinsen through, or null when it is not a link of
// ours. A link whose day has passed still answers (the caller checks the day).
export function proLinkUntil(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const key = input.trim();
  if (!key || key.length > 64) return null;
  const got = createHash("sha256").update(key).digest();
  const link = PRO_LINKS.find((l) => timingSafeEqual(got, Buffer.from(l.sha256, "hex")));
  return link ? link.til : null;
}

export const isCustomMetaphor = (metaphor: string): boolean =>
  !METAPHORS.includes(metaphor);

// The drawing style this request uses. Everyone may pick among them; an
// unknown one becomes the standard style.
export function allowedArtStyle(requested: unknown): string {
  return typeof requested === "string" && ART_STYLES.includes(requested)
    ? requested
    : DEFAULT_ART_STYLE;
}

// ---- Wishes ------------------------------------------------------------------

const weekKey = (vippsSub: string) => `bruker:${vippsSub}:uke`;

export const wishesPerWeek = (plan: Plan | null): number =>
  WISHES_PER_WEEK[plan === "pro" ? "pro" : "gratis"];

export interface WishBalance {
  // Left of this week's, how many the week started with, and bought ones.
  uke: number;
  ukeTotalt: number;
  kjopt: number;
}

// What the account has right now. If a counter can't be read, assume none
// are used rather than locking people out.
export async function wishBalance(vippsSub: string, plan: Plan | null): Promise<WishBalance> {
  const perWeek = wishesPerWeek(plan);
  const [used, rows] = await Promise.all([
    quotaRpc<number>("les_ukeskvote", { p_nokkel: weekKey(vippsSub) }),
    tableRequest<{ antall?: number; brukt_antall?: number }>(
      "GET",
      "kjop",
      `vipps_sub=eq.${encodeURIComponent(vippsSub)}&status=eq.betalt&brukt=is.null&select=antall,brukt_antall`
    ),
  ]);
  const bought = (rows ?? []).reduce(
    (sum, row) => sum + Math.max(0, (row.antall ?? 1) - (row.brukt_antall ?? 0)),
    0
  );
  return {
    uke: Math.max(0, perWeek - (typeof used === "number" ? used : 0)),
    ukeTotalt: perWeek,
    kjopt: bought,
  };
}

// One receipt per wish spent: "uke", or the reference of the purchase it
// came from. Handed to refundWishes when what was paid for didn't happen.
export type WishReceipts = string[];

// Spend `count` wishes, all or nothing. null when the account doesn't have
// that many. If the counter can't be reached the wishes are let through
// uncounted (an empty receipt), like the spending cap in budget.ts.
export async function spendWishes(
  vippsSub: string,
  count: number,
  plan: Plan | null
): Promise<WishReceipts | null> {
  if (!supabaseReady()) return [];
  const result = await callRpc<string[]>("bruk_onsker", {
    p_sub: vippsSub,
    p_antall: count,
    p_uke_grense: wishesPerWeek(plan),
  });
  if (!result.ok) return [];
  return Array.isArray(result.value) ? result.value : null;
}

export async function refundWishes(vippsSub: string, receipts: WishReceipts | null): Promise<void> {
  if (!receipts || receipts.length === 0) return;
  await callRpc<boolean>("gi_tilbake_onsker", { p_sub: vippsSub, p_kvitteringer: receipts });
}

// What to answer when there aren't enough wishes.
export const outOfWishes = (cost: number) => ({
  error:
    cost === 1
      ? "Du har ingen ønsker igjen. Nye kommer på mandag."
      : `Dette koster ${cost} ønsker, og så mange har du ikke. Nye kommer på mandag.`,
  grense: "onsker",
  koster: cost,
});

// ---- Read-aloud ----------------------------------------------------------------
//
// Read-aloud of a story costs one wish, once. The server then signs a pass
// for that story (`key` is the story's seed) and that account; the client
// sends it with the story's speech requests and saves it with the story, so
// listening again is free.
const PASS_LIFETIME_SEC = 5 * 365 * 24 * 60 * 60;

export const validStoryKey = (key: unknown): key is string =>
  typeof key === "string" && /^[0-9a-zA-Z-]{1,64}$/.test(key);

export const readAloudPass = (vippsSub: string, storyKey: string): string =>
  sealCookie("les", { sub: vippsSub, h: storyKey }, PASS_LIFETIME_SEC);

// May this request read aloud? Yes with the story's pass. Stories made as
// «Magihistorie» before wishes came carry a ticket (`billett`) that gave
// them read-aloud; it still does.
export function mayReadAloud(
  session: Session,
  body: { lesepass?: unknown; historie?: unknown; billett?: unknown }
): boolean {
  const open = (purpose: string, value: unknown) => {
    if (typeof value !== "string" || value.length > 600) return null;
    try {
      return openCookie<{ sub: string; h?: string }>(purpose, value);
    } catch {
      return null;
    }
  };
  const pass = open("les", body.lesepass);
  if (pass && pass.sub === session.sub && validStoryKey(body.historie) && pass.h === body.historie) {
    return true;
  }
  return open("din-historie", body.billett)?.sub === session.sub;
}
