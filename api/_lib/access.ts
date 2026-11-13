// Who may do what. The first pages of a story can be read without a login
// (GUEST_PAGES); going on requires one. Pro adds unlimited stories,
// read-aloud, the choice of drawing style and your own moral. Everything is
// checked here on the server — the browser only hides the buttons.
import { createHash, timingSafeEqual } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { openCookie, readSession, sealCookie, type Session } from "./session.js";
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

// A personal story («Magihistorie») made on the free plan gets a signed
// ticket from /api/opener. The client sends it along with the later
// requests of that story, and it gives what Pro gives: your own moral, the
// chosen drawing style and read-aloud. It belongs to one account.
const TICKET_LIFETIME_SEC = 5 * 365 * 24 * 60 * 60;

export const personalTicket = (vippsSub: string): string =>
  sealCookie("din-historie", { sub: vippsSub }, TICKET_LIFETIME_SEC);

function ticketFits(session: Session, ticket: unknown): boolean {
  if (typeof ticket !== "string" || ticket.length > 600) return false;
  try {
    return openCookie<{ sub: string }>("din-historie", ticket)?.sub === session.sub;
  } catch {
    return false;
  }
}

// May this request use what belongs to a personal story? Yes with a ticket
// for one, or on Pro. Only looks the plan up when it matters.
export async function mayPersonalize(
  session: Session | null,
  ticket: unknown
): Promise<boolean> {
  if (!session) return false;
  return ticketFits(session, ticket) || (await isPro(session.sub));
}

// The drawing style this request may use: the one asked for in a personal
// story or on Pro, otherwise the standard one.
export async function allowedArtStyle(
  session: Session | null,
  requested: unknown,
  ticket: unknown
): Promise<string> {
  if (
    typeof requested !== "string" ||
    !ART_STYLES.includes(requested) ||
    requested === DEFAULT_ART_STYLE
  ) {
    return DEFAULT_ART_STYLE;
  }
  return (await mayPersonalize(session, ticket)) ? requested : DEFAULT_ART_STYLE;
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

const takeUpTo = (vippsSub: string, limit: number) =>
  quotaRpc<boolean>("bruk_ukeskvote", {
    p_nokkel: quotaKey(vippsSub),
    p_grense: limit,
  });

// Take one of this week's free stories. False when there isn't room. A
// personal story uses the whole week: it needs none to be used, and takes
// them all.
export async function takeFreeStory(
  vippsSub: string,
  personal = false
): Promise<boolean> {
  if (!personal) {
    return (await takeUpTo(vippsSub, FREE_STORIES_PER_WEEK)) !== false;
  }
  // The first slot is only given when the counter stands at zero.
  if ((await takeUpTo(vippsSub, 1)) === false) return false;
  for (let taken = 1; taken < FREE_STORIES_PER_WEEK; taken++) {
    await takeUpTo(vippsSub, FREE_STORIES_PER_WEEK);
  }
  return true;
}
