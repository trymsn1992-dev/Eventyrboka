// Who may do what. Making stories requires a login; Pro adds unlimited
// stories, read-aloud, the choice of drawing style and your own moral. Everything is
// checked here on the server — the browser only hides the buttons.
import { createHash, timingSafeEqual } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { readSession, type Session } from "./session.js";
import { getAccount, quotaRpc } from "./supabase.js";
import {
  ART_STYLES,
  DEFAULT_ART_STYLE,
  FREE_STORIES_PER_WEEK,
  METAPHORS,
} from "../../types.js";

// Answers 401 and returns null when nobody is logged in.
export function requireLogin(
  req: VercelRequest,
  res: VercelResponse
): Session | null {
  const session = readSession(req);
  if (!session) {
    res.status(401).json({ error: "Du må logge inn for å lage eventyr." });
    return null;
  }
  return session;
}

export async function isPro(vippsSub: string): Promise<boolean> {
  return (await getAccount(vippsSub)).plan === "pro";
}

// The friend code that unlocks Pro. Only its SHA-256 is kept in the code.
const PRO_CODE_SHA256 =
  "4e8ed9dff07d85f00590fd65f8e7b3d945ce75dbe70c9ec28b3a411655c8edb7";

export function validProCode(input: unknown): boolean {
  if (typeof input !== "string") return false;
  const cleaned = input.trim().toUpperCase().slice(0, 64);
  if (!cleaned) return false;
  const got = createHash("sha256").update(cleaned).digest();
  return timingSafeEqual(got, Buffer.from(PRO_CODE_SHA256, "hex"));
}

export const isCustomMetaphor = (metaphor: string): boolean =>
  !METAPHORS.includes(metaphor);

// The drawing style this user may use: the one asked for if they are on
// Pro, otherwise the standard one. Only looks the plan up when it matters.
export async function allowedArtStyle(
  vippsSub: string,
  requested: unknown
): Promise<string> {
  if (
    typeof requested !== "string" ||
    !ART_STYLES.includes(requested) ||
    requested === DEFAULT_ART_STYLE
  ) {
    return DEFAULT_ART_STYLE;
  }
  return (await isPro(vippsSub)) ? requested : DEFAULT_ART_STYLE;
}

const quotaKey = (vippsSub: string) => `bruker:${vippsSub}:uke`;

// Free stories left this week (never below 0). If the counter can't be
// read, assume none are used rather than locking people out.
export async function freeStoriesLeft(vippsSub: string): Promise<number> {
  const used = await quotaRpc<number>("les_ukeskvote", {
    p_nokkel: quotaKey(vippsSub),
  });
  return Math.max(0, FREE_STORIES_PER_WEEK - (typeof used === "number" ? used : 0));
}

// Take one of this week's free stories. False when they are used up.
export async function takeFreeStory(vippsSub: string): Promise<boolean> {
  const ok = await quotaRpc<boolean>("bruk_ukeskvote", {
    p_nokkel: quotaKey(vippsSub),
    p_grense: FREE_STORIES_PER_WEEK,
  });
  return ok !== false;
}
