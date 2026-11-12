// GET: tells the client whether the user is logged in, whether login is wired
// up at all, and which setup choices the user has saved. The response shape
// drives the login/logout button in the header.
// POST: saves the setup choices (age group, reading length and drawing style)
// to the account, picks the free plan, or redeems a code for Pro.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  SESSION_LIFETIME_SEC,
  readSession,
  sessionCookie,
} from "./_lib/session.js";
import { vippsReady } from "./_lib/vipps.js";
import {
  getAccount,
  savePreferences,
  setPlan,
  supabaseReady,
} from "./_lib/supabase.js";
import { freeStoriesLeft, validProCode } from "./_lib/access.js";
import { getClientIp, rateLimit } from "./_lib/rate-limit.js";
import { AGE_GROUPS, ART_STYLES, DURATIONS } from "../types.js";

const DAY_SEC = 24 * 60 * 60;

// Only known values are stored or handed back.
function cleanPreferences(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  if (typeof r.ageGroup === "string" && AGE_GROUPS.includes(r.ageGroup)) {
    out.ageGroup = r.ageGroup;
  }
  if (typeof r.duration === "string" && DURATIONS.includes(r.duration)) {
    out.duration = r.duration;
  }
  if (typeof r.artStyle === "string" && ART_STYLES.includes(r.artStyle)) {
    out.artStyle = r.artStyle;
  }
  return out;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  const session = readSession(req);
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "POST") {
    // Same-origin only, like /api/loggut.
    const site = req.headers["sec-fetch-site"];
    const origin = req.headers.origin;
    const host = (req.headers["x-forwarded-host"] || req.headers.host) as string;
    if (
      (site && site !== "same-origin") ||
      (origin && origin !== `https://${host}`)
    ) {
      res.statusCode = 403;
      res.end();
      return;
    }
    if (!session) {
      res.statusCode = 401;
      res.end();
      return;
    }
    const body = (req.body ?? {}) as { valg?: unknown; plan?: unknown; kode?: unknown };

    // Redeem a code for Pro.
    if (body.kode !== undefined) {
      // Guessing codes should be slow.
      if (!rateLimit(`kode:${getClientIp(req)}`).ok) {
        res.statusCode = 429;
        res.end();
        return;
      }
      if (!validProCode(body.kode)) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ error: "Koden stemmer ikke." }));
        return;
      }
      const saved = await setPlan(session.sub, "pro");
      res.statusCode = saved ? 204 : 503;
      res.end();
      return;
    }

    // Pick the free plan. Never downgrades someone who already has Pro.
    if (body.plan !== undefined) {
      if (body.plan !== "gratis") {
        res.statusCode = 400;
        res.end();
        return;
      }
      const current = (await getAccount(session.sub)).plan;
      const saved = current === "pro" ? true : await setPlan(session.sub, "gratis");
      res.statusCode = saved ? 204 : 503;
      res.end();
      return;
    }

    const ok = await savePreferences(session.sub, cleanPreferences(body.valg));
    res.statusCode = ok ? 204 : 503;
    res.end();
    return;
  }

  const innlogget = Boolean(session);
  let valg: Record<string, string> = {};
  // null = not chosen yet (the plan page is shown after login).
  let plan: "gratis" | "pro" | null = null;
  // Free stories left this week; null on Pro (no limit).
  let gratisIgjen: number | null = null;
  if (session) {
    // Renew the login at most once a day, so it never runs out for someone
    // who keeps coming back.
    const age = SESSION_LIFETIME_SEC - (session.expires - Math.floor(Date.now() / 1000));
    if (age > DAY_SEC) {
      res.setHeader("Set-Cookie", sessionCookie(session.sub, session.fornavn || ""));
    }
    const [account, left] = await Promise.all([
      getAccount(session.sub),
      freeStoriesLeft(session.sub),
    ]);
    valg = cleanPreferences(account.innstillinger);
    plan = account.plan;
    gratisIgjen = plan === "pro" ? null : left;
  }
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(
    JSON.stringify({
      vippsKlar: vippsReady(),
      supabaseKlar: supabaseReady(),
      innlogget,
      fornavn: innlogget ? session?.fornavn || "" : "",
      valg,
      plan,
      gratisIgjen,
    })
  );
}
