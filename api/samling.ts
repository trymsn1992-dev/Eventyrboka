// The logged-in user's own heroes and morals (see _lib/samling.ts).
//   GET     -> { helter: [...], laerepenger: [...] }
//   POST    -> { helt: {...} } or { laerepenge: "..." }; answers { id }
//   DELETE  -> ?id=...
// The session cookie decides whose they are — never anything the client sends.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { readSession } from "./_lib/session.js";
import { supabaseReady } from "./_lib/supabase.js";
import { openHero } from "./_lib/hero.js";
import { parseDataUrl } from "./_lib/gemini.js";
import { getClientIp, rateLimit } from "./_lib/rate-limit.js";
import {
  deleteItem,
  heroItemId,
  listItems,
  saveItem,
  validItemId,
} from "./_lib/samling.js";
import { ART_STYLES, DEFAULT_ART_STYLE } from "../types.js";

export const config = { maxDuration: 30 };

// The drawn hero is sent as a small JPEG (see services/samling.ts).
const MAX_SHEET_CHARS = 1_500_000;

const json = (res: VercelResponse, status: number, body: unknown): void => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
};

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  const session = readSession(req);
  if (!session) {
    res.statusCode = 401;
    res.end();
    return;
  }
  if (!supabaseReady()) {
    res.statusCode = 503;
    res.end();
    return;
  }

  if (req.method === "GET") {
    const items = await listItems(session.sub);
    if (!items) {
      res.statusCode = 503;
      res.end();
      return;
    }
    const helter = items
      .filter((item) => item.type === "helt")
      .map((item) => {
        const d = item.data;
        // The name comes from the signed token, like everywhere else.
        const hero = openHero(d.token);
        if (!hero || typeof d.sheet !== "string") return null;
        return {
          id: item.id,
          name: hero.name,
          tagline: typeof d.tagline === "string" ? d.tagline : "",
          token: d.token as string,
          sheet: d.sheet,
          artStyle: typeof d.artStyle === "string" ? d.artStyle : DEFAULT_ART_STYLE,
        };
      })
      .filter((hero) => hero !== null);
    const laerepenger = items
      .filter((item) => item.type === "laerepenge" && typeof item.data.tekst === "string")
      .map((item) => ({ id: item.id, tekst: item.data.tekst as string }));
    json(res, 200, { helter, laerepenger });
    return;
  }

  if (req.method !== "POST" && req.method !== "DELETE") {
    res.setHeader("Allow", "GET, POST, DELETE");
    res.statusCode = 405;
    res.end();
    return;
  }

  // Same-origin only, like /api/meg.
  const site = req.headers["sec-fetch-site"];
  const origin = req.headers.origin;
  const host = (req.headers["x-forwarded-host"] || req.headers.host) as string;
  if ((site && site !== "same-origin") || (origin && origin !== `https://${host}`)) {
    res.statusCode = 403;
    res.end();
    return;
  }
  if (!rateLimit(`samling:${getClientIp(req)}`).ok) {
    res.statusCode = 429;
    res.end();
    return;
  }

  if (req.method === "DELETE") {
    const url = new URL(req.url || "/", "https://magiboka.invalid");
    const id = url.searchParams.get("id");
    if (!validItemId(id)) {
      res.statusCode = 400;
      res.end();
      return;
    }
    res.statusCode = (await deleteItem(session.sub, id)) ? 204 : 500;
    res.end();
    return;
  }

  const body = (req.body ?? {}) as { helt?: unknown };

  // A hero is paid for with a wish where it is drawn (/api/figur), and its
  // token is signed there — so keeping it here costs nothing more. A moral
  // of your own is paid for and kept by /api/opener, not here.

  if (body.helt && typeof body.helt === "object") {
    const h = body.helt as Record<string, unknown>;
    // Only heroes the server drew itself: the token is signed (see _lib/hero.ts).
    const hero = openHero(h.token);
    if (
      !hero ||
      typeof h.sheet !== "string" ||
      h.sheet.length > MAX_SHEET_CHARS ||
      !parseDataUrl(h.sheet)
    ) {
      res.statusCode = 400;
      res.end();
      return;
    }
    const id = heroItemId(session.sub, h.token as string);
    const saved = await saveItem(session.sub, "helt", id, {
      token: h.token,
      sheet: h.sheet,
      tagline: typeof h.tagline === "string" ? h.tagline.slice(0, 160) : "",
      artStyle:
        typeof h.artStyle === "string" && ART_STYLES.includes(h.artStyle)
          ? h.artStyle
          : DEFAULT_ART_STYLE,
    });
    if (saved === "ok") json(res, 200, { id });
    else json(res, saved === "full" ? 409 : 503, {});
    return;
  }

  res.statusCode = 400;
  res.end();
}
