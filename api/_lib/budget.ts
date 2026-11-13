// Daily spending cap for Gemini. Every call that costs money first takes a
// slot from two counters in Supabase: one for everyone together (the budget)
// and one per visitor (so a single person can't use up the whole day). The
// counters reset at midnight Norwegian time.
//
// The counting happens in one Postgres function (tell_forbruk in
// supabase/schema.sql), so it is correct even when many serverless instances
// run at once — unlike rate-limit.ts, which only sees its own instance.
//
// If Supabase is not set up, or the function has not been created yet, the
// cap is NOT enforced: the app keeps working and an error is logged.
import { createHash } from "node:crypto";
import { getClientIp } from "./rate-limit.js";
import { supabaseKey, supabaseReady, supabaseUrl } from "./supabase.js";

export type BudgetKind = "story" | "image" | "text" | "speech";

const intEnv = (name: string, fallback: number): number => {
  const n = Number.parseInt((process.env[name] || "").trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

// New stories per day: for everyone together, and per visitor. Change them
// with the environment variables DAILY_STORY_LIMIT and
// DAILY_STORY_LIMIT_PER_IP in Vercel — no code change needed.
const storiesTotal = () => intEnv("DAILY_STORY_LIMIT", 100);
const storiesPerVisitor = () => intEnv("DAILY_STORY_LIMIT_PER_IP", 10);
// Stories a visitor may start per day without logging in
// (DAILY_GUEST_STORY_LIMIT_PER_IP). They count towards the total above too.
const guestStoriesPerVisitor = () => intEnv("DAILY_GUEST_STORY_LIMIT_PER_IP", 3);

// What one story may use at most. A story is 1 character sheet + up to 5
// illustrations, and up to 8 page texts (both choices are written for each
// page); the rest is room for re-reading along other branches.
const PER_STORY: Record<BudgetKind, number> = {
  story: 1,
  image: 8,
  text: 20,
  speech: 5,
};

// What the pages before the login may use: 1 character sheet + 2
// illustrations, and page 2 written for both choices plus an early ending.
const PER_GUEST_STORY: Record<BudgetKind, number> = {
  story: 1,
  image: 3,
  text: 3,
  speech: 0,
};

const MESSAGES: Record<"alle" | "ip", string> = {
  alle: "Magiboka har laget alle eventyrene den rekker i dag. Kom tilbake i morgen!",
  ip: "Dere har laget mange eventyr i dag. Kom tilbake i morgen for flere!",
};
const GUEST_MESSAGE = "Logg inn med Vipps for å lage flere eventyr i dag.";

// The visitor's IP is never stored — only a short, salted hash of it.
function visitorKey(req: Parameters<typeof getClientIp>[0]): string {
  const salt = (process.env.SESSION_SECRET || "magiboka").trim();
  return createHash("sha256")
    .update(`${salt}|${getClientIp(req)}`)
    .digest("hex")
    .slice(0, 16);
}

let warned = false;
const warnOnce = (message: string) => {
  if (warned) return;
  warned = true;
  console.error(`Kostnadstak IKKE aktivt: ${message}`);
};

// `message` is what to tell the visitor when ok is false.
export interface BudgetResult {
  ok: boolean;
  message: string;
}

const ALLOWED: BudgetResult = { ok: true, message: "" };

// Take one slot of `kind` for this visitor. Call before the Gemini request.
// Visitors who are not logged in (`guest`) have a smaller allowance of their own.
export async function spend(
  req: Parameters<typeof getClientIp>[0],
  kind: BudgetKind,
  guest = false
): Promise<BudgetResult> {
  if (!supabaseReady()) {
    warnOnce("Supabase er ikke satt opp (SUPABASE_URL / SUPABASE_SERVICE_KEY).");
    return ALLOWED;
  }
  try {
    const key = supabaseKey();
    const r = await fetch(`${supabaseUrl()}/rest/v1/rpc/tell_forbruk`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_ip_nokkel: `ip:${visitorKey(req)}:${guest ? "gjest-" : ""}${kind}`,
        p_ip_grense: guest
          ? guestStoriesPerVisitor() * PER_GUEST_STORY[kind]
          : storiesPerVisitor() * PER_STORY[kind],
        p_alle_nokkel: `alle:${kind}`,
        p_alle_grense: storiesTotal() * PER_STORY[kind],
      }),
    });
    if (!r.ok) {
      warnOnce(
        `tell_forbruk svarte HTTP ${r.status}. Er supabase/schema.sql kjørt? ${(
          await r.text()
        ).slice(0, 200)}`
      );
      return ALLOWED;
    }
    const verdict = (await r.json()) as unknown;
    if (verdict === "alle" || verdict === "ip") {
      console.warn(`Kostnadstak nådd (${verdict}) for ${kind}.`);
      return {
        ok: false,
        message: guest && verdict === "ip" ? GUEST_MESSAGE : MESSAGES[verdict],
      };
    }
    return ALLOWED;
  } catch (err) {
    warnOnce(`fikk ikke kontakt med Supabase: ${(err as Error).message}`);
    return ALLOWED;
  }
}
