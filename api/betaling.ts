// Payment with Vipps (see _lib/betaling.ts). POST with one of:
//   { kjop: "historie" | "din-historie" }  buy one story        -> { url }
//   { abonner: true }                      start Prinsen        -> { url }
//   { bekreft: <reference>, slag: "kjop" | "avtale" }
//                                          back from Vipps      -> { status, ... }
//   { stopp: true }                        cancel Prinsen       -> { betaltTil }
// `url` is where the browser goes to pay or approve.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { readSession } from "./_lib/session.js";
import { isPro } from "./_lib/access.js";
import { getClientIp, rateLimit } from "./_lib/rate-limit.js";
import {
  confirmPurchase,
  confirmSubscription,
  isPurchaseKind,
  purchasesReady,
  siteOrigin,
  startPurchase,
  startSubscription,
  stopSubscription,
  subscriptionReady,
} from "./_lib/betaling.js";

export const maxDuration = 30;

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.status(405).end();
    return;
  }
  // Same-origin only, like /api/meg.
  const site = req.headers["sec-fetch-site"];
  const origin = req.headers.origin;
  if ((site && site !== "same-origin") || (origin && origin !== siteOrigin(req))) {
    res.status(403).end();
    return;
  }
  if (!rateLimit(`betaling:${getClientIp(req)}`).ok) {
    res.status(429).json({ error: "Du må vente litt før du prøver igjen." });
    return;
  }

  const session = readSession(req);
  const body = (req.body ?? {}) as {
    kjop?: unknown;
    abonner?: unknown;
    bekreft?: unknown;
    slag?: unknown;
    stopp?: unknown;
  };

  // Back from Vipps. No login needed: Vipps may open the site in another
  // browser than the one the buyer is logged in to. The reference is a
  // secret only the buyer has, and what was paid for always goes to the
  // account that started it.
  if (typeof body.bekreft === "string") {
    if (body.slag === "avtale") {
      const { status, vippsSub } = await confirmSubscription(body.bekreft);
      res.status(200).json({ status, min: Boolean(session && session.sub === vippsSub) });
      return;
    }
    const { status, kind, vippsSub } = await confirmPurchase(body.bekreft);
    res
      .status(200)
      .json({ status, type: kind, min: Boolean(session && session.sub === vippsSub) });
    return;
  }

  if (!session) {
    res.status(401).json({ error: "Logg inn for å betale." });
    return;
  }

  if (body.kjop !== undefined) {
    if (!purchasesReady()) {
      res.status(503).json({ error: "Kjøp av historier er ikke åpnet ennå." });
      return;
    }
    if (!isPurchaseKind(body.kjop)) {
      res.status(400).json({ error: "Ukjent historietype." });
      return;
    }
    const url = await startPurchase(session.sub, body.kjop, siteOrigin(req));
    if (!url) {
      res.status(502).json({ error: "Fikk ikke kontakt med Vipps. Prøv igjen om litt." });
      return;
    }
    res.status(200).json({ url });
    return;
  }

  if (body.abonner !== undefined) {
    if (!subscriptionReady()) {
      res.status(503).json({ error: "Prinsen kan ikke kjøpes ennå." });
      return;
    }
    // Also those who have Prinsen from a share link: nothing to pay for.
    const started = (await isPro(session.sub))
      ? "har"
      : await startSubscription(session.sub, siteOrigin(req));
    if (started === "har") {
      res.status(409).json({ error: "Du er allerede Prinsen." });
      return;
    }
    if (!started) {
      res.status(502).json({ error: "Fikk ikke kontakt med Vipps. Prøv igjen om litt." });
      return;
    }
    res.status(200).json(started);
    return;
  }

  if (body.stopp !== undefined) {
    const paidUntil = await stopSubscription(session.sub);
    if (!paidUntil) {
      res.status(502).json({
        error: "Kunne ikke si opp nå. Prøv igjen om litt, eller si opp avtalen i Vipps-appen.",
      });
      return;
    }
    res.status(200).json({ betaltTil: paidUntil });
    return;
  }

  res.status(400).end();
}
