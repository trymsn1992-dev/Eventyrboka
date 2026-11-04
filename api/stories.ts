// List, save and delete the logged-in user's stories. The session cookie
// decides which vipps_sub we talk to Supabase about — never anything the
// client sends in the body or query string.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { readSession } from "./_lib/session.js";
import {
  deleteStory,
  listStories,
  supabaseReady,
  upsertStory,
} from "./_lib/supabase.js";
import type { SavedStory } from "../types.js";

// A story with illustrations is a few hundred kilobytes. 5 MB is enough
// headroom for one story with several illustrated pages while still
// rejecting pathological payloads.
const MAX_BODY_BYTES = 5 * 1024 * 1024;

async function readBody(req: VercelRequest): Promise<string> {
  let total = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req as unknown as AsyncIterable<Buffer>) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw new Error("for stor");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function isSavedStory(x: unknown): x is SavedStory {
  if (!x || typeof x !== "object") return false;
  const s = x as Record<string, unknown>;
  return (
    typeof s.id === "string" &&
    typeof s.createdAt === "number" &&
    Array.isArray(s.segments) &&
    typeof s.options === "object" &&
    s.options !== null
  );
}

export const config = {
  // Big-ish stories carry base64 images in the segments array. Default 4 MB
  // response/request limits are enough, but the serverless timeout should
  // allow room for Supabase round-trips.
  maxDuration: 30,
};

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
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
    const stories = await listStories(session.sub);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.statusCode = 200;
    res.end(JSON.stringify(stories));
    return;
  }

  if (req.method === "POST") {
    let story: unknown;
    try {
      const body = await readBody(req);
      story = JSON.parse(body);
    } catch {
      res.statusCode = 400;
      res.end();
      return;
    }
    if (!isSavedStory(story)) {
      res.statusCode = 400;
      res.end();
      return;
    }
    const ok = await upsertStory(session.sub, story);
    res.statusCode = ok ? 204 : 500;
    res.end();
    return;
  }

  if (req.method === "DELETE") {
    const url = new URL(req.url || "/", "https://eventyrboka.invalid");
    const id = url.searchParams.get("id") || "";
    if (!id) {
      res.statusCode = 400;
      res.end();
      return;
    }
    const ok = await deleteStory(session.sub, id);
    res.statusCode = ok ? 204 : 500;
    res.end();
    return;
  }

  res.setHeader("Allow", "GET, POST, DELETE");
  res.statusCode = 405;
  res.end();
}
