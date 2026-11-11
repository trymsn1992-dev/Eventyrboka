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
import {
  deleteStoryImages,
  signImages,
  signedUrlFor,
  validImageKey,
  validStoryId,
} from "./_lib/storage.js";
import type { SavedStory } from "../types.js";

// Illustrations go up separately via /api/bilde, so the story itself is
// just text. 1 MB is generous for that and far under Vercel's 4.5 MB cap.
const MAX_BODY_BYTES = 1024 * 1024;

// Never store pictures inline in the row: drop any image data the client
// sent, keep only valid storage keys, and leave out the character sheet
// (it is only needed while the story is being generated).
function withoutInlineImages(story: SavedStory): SavedStory {
  const segments = story.segments.map((seg) => {
    const { imageBase64: _drop, imageKey, ...rest } = seg;
    return validImageKey(imageKey) ? { ...rest, imageKey } : rest;
  });
  const plan = story.plan
    ? (({ characterSheetBase64: _sheet, ...p }) => p)(story.plan)
    : undefined;
  return { ...story, segments, ...(plan ? { plan } : {}) };
}

// Turn storage keys back into image URLs the browser can show.
async function withImageUrls(
  vippsSub: string,
  stories: SavedStory[]
): Promise<SavedStory[]> {
  const items = stories.flatMap((story) =>
    story.segments
      .filter((seg) => validImageKey(seg.imageKey))
      .map((seg) => ({ storyId: story.id, key: seg.imageKey as string }))
  );
  const signed = await signImages(vippsSub, items);
  return stories.map((story) => ({
    ...story,
    segments: story.segments.map((seg) => {
      if (!validImageKey(seg.imageKey)) return seg;
      const url = signedUrlFor(signed, vippsSub, story.id, seg.imageKey);
      return url ? { ...seg, imageBase64: url } : seg;
    }),
  }));
}

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
  // Room for the Supabase round-trips (rows + signing image URLs).
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
    const stories = await withImageUrls(
      session.sub,
      await listStories(session.sub)
    );
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
    const ok = await upsertStory(session.sub, withoutInlineImages(story));
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
    if (ok && validStoryId(id)) await deleteStoryImages(session.sub, id);
    res.statusCode = ok ? 204 : 500;
    res.end();
    return;
  }

  res.setHeader("Allow", "GET, POST, DELETE");
  res.statusCode = 405;
  res.end();
}
