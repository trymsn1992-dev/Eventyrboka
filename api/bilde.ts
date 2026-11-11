// Uploads one illustration for a story the logged-in user is saving.
// Images go up one at a time so no single request comes near Vercel's
// 4.5 MB body limit; /api/stories then stores the text only.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { readSession } from "./_lib/session.js";
import { supabaseReady } from "./_lib/supabase.js";
import { uploadImage, validImageKey, validStoryId } from "./_lib/storage.js";

export const config = { maxDuration: 30 };

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.statusCode = 405;
    res.end();
    return;
  }
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
  const body = (req.body ?? {}) as {
    storyId?: unknown;
    key?: unknown;
    bilde?: unknown;
  };
  if (!validStoryId(body.storyId) || !validImageKey(body.key)) {
    res.statusCode = 400;
    res.end();
    return;
  }
  res.statusCode = await uploadImage(
    session.sub,
    body.storyId,
    body.key,
    body.bilde
  );
  res.end();
}
