// Who may do what. The first pages of a story can be read without a login
// (GUEST_PAGES); going on requires one. Pro adds unlimited stories,
// read-aloud, the choice of drawing style and your own moral. Everything is
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

// Share links that give Pro: https://www.magiboka.no/?prinsen=<key>.
// Whoever opens one and logs in gets Pro. Only the SHA-256 of each key is
// kept here. Remove a line to stop that link from working (those who already
// used it keep Pro); add a line to make a new link.
const PRO_LINK_SHA256 = [
  "b1841cd7940513b6c70bb91cd76252b9e8f7cdb1c492908e69e892382c97db38",
];

export function validProLink(input: unknown): boolean {
  if (typeof input !== "string") return false;
  const key = input.trim();
  if (!key || key.length > 64) return false;
  const got = createHash("sha256").update(key).digest();
  return PRO_LINK_SHA256.some((hex) => timingSafeEqual(got, Buffer.from(hex, "hex")));
}

export const isCustomMetaphor = (metaphor: string): boolean =>
  !METAPHORS.includes(metaphor);

// The drawing style this user may use: the one asked for if they are on
// Pro, otherwise the standard one. Only looks the plan up when it matters.
export async function allowedArtStyle(
  session: Session | null,
  requested: unknown
): Promise<string> {
  if (
    !session ||
    typeof requested !== "string" ||
    !ART_STYLES.includes(requested) ||
    requested === DEFAULT_ART_STYLE
  ) {
    return DEFAULT_ART_STYLE;
  }
  return (await isPro(session.sub)) ? requested : DEFAULT_ART_STYLE;
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
