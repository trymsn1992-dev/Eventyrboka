// Clears the session cookie. POST-only so a GET from a stray link can't
// silently log the user out, and same-origin only so another site can't.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { buildCookie } from "./_lib/session.js";

export default function handler(
  req: VercelRequest,
  res: VercelResponse
): void {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.end();
    return;
  }
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
  res.setHeader("Set-Cookie", buildCookie("eventyrboka_okt", "", 0));
  res.setHeader("Cache-Control", "no-store");
  res.statusCode = 204;
  res.end();
}
