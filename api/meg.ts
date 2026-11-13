// GET: tells the client whether the user is logged in, whether login is wired
// up at all, and which setup choices the user has saved. The response shape
// drives the login/logout button in the header.
// It also says what can be bought with Vipps and what the user has paid for.
// POST: saves the setup choices (age group, reading length and drawing style)
// to the account, picks the free plan, redeems a share link for Pro, or
// counts a story that was started before logging in.
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
import { freeStoriesLeft, isPro, takeFreeStory, validProLink } from "./_lib/access.js";
import { getClientIp, rateLimit } from "./_lib/rate-limit.js";
import {
  boughtStories,
  purchasesReady,
  subscriptionOf,
  subscriptionReady,
  useBoughtStory,
  type Subscription,
} from "./_lib/betaling.js";
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
    const body = (req.body ?? {}) as {
      valg?: unknown;
      plan?: unknown;
      lenke?: unknown;
      gjestehistorie?: unknown;
    };

    // A share link that gives Pro. The key is checked before the login, so
    // the page can tell a visitor at once whether their link works: 400 =
    // not a valid link, 401 = valid, log in to use it.
    if (body.lenke !== undefined) {
      // Guessing keys should be slow.
      if (!rateLimit(`lenke:${getClientIp(req)}`).ok) {
        res.statusCode = 429;
        res.end();
        return;
      }
      if (!validProLink(body.lenke)) {
        res.statusCode = 400;
        res.end();
        return;
      }
      if (!session) {
        res.statusCode = 401;
        res.end();
        return;
      }
      const saved = await setPlan(session.sub, "pro");
      res.statusCode = saved ? 204 : 503;
      res.end();
      return;
    }

    if (!session) {
      res.statusCode = 401;
      res.end();
      return;
    }

    // A story started before logging in is read on: on the free plan it
    // is one of this week's free stories, or else a bought one. 429 when
    // there is neither.
    if (body.gjestehistorie !== undefined) {
      if ((await isPro(session.sub)) || (await takeFreeStory(session.sub))) {
        res.statusCode = 204;
        res.end();
        return;
      }
      const bought = await useBoughtStory(session.sub, "historie");
      res.statusCode = bought ? 200 : 429;
      if (bought) res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(bought ? JSON.stringify({ kjopt: true }) : undefined);
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
  // Free stories left this week (a personal one needs them all); null on Pro.
  let gratisIgjen: number | null = null;
  // Bought stories not yet made, and the Prinsen subscription if there is one.
  let tilGode = { historie: 0, dinHistorie: 0 };
  let abonnement: Subscription | null = null;
  if (session) {
    // Renew the login at most once a day, so it never runs out for someone
    // who keeps coming back.
    const age = SESSION_LIFETIME_SEC - (session.expires - Math.floor(Date.now() / 1000));
    if (age > DAY_SEC) {
      res.setHeader("Set-Cookie", sessionCookie(session.sub, session.fornavn || ""));
    }
    const [account, left, bought, subscription] = await Promise.all([
      getAccount(session.sub),
      freeStoriesLeft(session.sub),
      boughtStories(session.sub),
      subscriptionOf(session.sub),
    ]);
    tilGode = bought;
    abonnement = subscription;
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
      // Whether single stories and Prinsen can be bought with Vipps yet.
      kjopKlar: purchasesReady(),
      abonnementKlar: subscriptionReady(),
      tilGode,
      abonnement: abonnement && { status: abonnement.status, betaltTil: abonnement.paidUntil },
    })
  );
}
