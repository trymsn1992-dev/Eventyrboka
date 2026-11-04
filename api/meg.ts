// Tells the client whether the user is logged in, and whether login is wired
// up at all. The response shape drives the login/logout button in the header.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { readSession } from "./_lib/session.js";
import { vippsReady } from "./_lib/vipps.js";
import { supabaseReady } from "./_lib/supabase.js";

export default function handler(
  req: VercelRequest,
  res: VercelResponse
): void {
  const session = readSession(req);
  const innlogget = Boolean(session);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(
    JSON.stringify({
      vippsKlar: vippsReady(),
      supabaseKlar: supabaseReady(),
      innlogget,
      fornavn: innlogget ? session?.fornavn || "" : "",
    })
  );
}
