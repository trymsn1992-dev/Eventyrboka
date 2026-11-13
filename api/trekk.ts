// The daily payment job, run by Vercel Cron (see vercel.json): orders next
// week's Prinsen charges at Vipps, records the ones that went through, and
// ends subscriptions that are cancelled or unpaid. Vercel sends CRON_SECRET
// as a bearer token; nobody else gets in.
import { timingSafeEqual } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { dailyRound } from "./_lib/betaling.js";

export const maxDuration = 60;

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  const secret = (process.env.CRON_SECRET || "").trim();
  const got = Buffer.from(String(req.headers.authorization || ""));
  const expected = Buffer.from(`Bearer ${secret}`);
  if (!secret || got.length !== expected.length || !timingSafeEqual(got, expected)) {
    res.status(401).end();
    return;
  }
  const counts = await dailyRound();
  console.log("trekk.dagens-runde", JSON.stringify(counts));
  res.status(200).json(counts);
}
