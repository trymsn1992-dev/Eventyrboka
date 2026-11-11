// Supabase Storage for story illustrations. Images live as files in a
// private bucket, never inline in the story row: a story with five base64
// PNGs is ~10 MB, well past Vercel's 4.5 MB request/response limit.
//
// Paths are always built here from the session's vipps_sub, so a client can
// only ever read or write under its own prefix.
import { supabaseKey, supabaseReady, supabaseUrl } from "./supabase.js";

const BUCKET = "illustrasjoner";
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
// Signed links are re-issued every time the story list is fetched, so a
// day is plenty and keeps a leaked link short-lived.
const SIGNED_URL_SECONDS = 24 * 60 * 60;

// Story ids are client-generated UUIDs; image keys are "side-<index>".
export const validStoryId = (id: unknown): id is string =>
  typeof id === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(id);
export const validImageKey = (key: unknown): key is string =>
  typeof key === "string" && /^side-\d{1,3}$/.test(key);

const storageBase = () => `${supabaseUrl()}/storage/v1`;

function authHeaders(): Record<string, string> {
  const key = supabaseKey();
  return { apikey: key, Authorization: `Bearer ${key}` };
}

const objectPath = (vippsSub: string, storyId: string, key = "") =>
  `${encodeURIComponent(vippsSub)}/${storyId}${key ? `/${key}` : ""}`;

// Create the private bucket on first use, so no one has to click it into
// existence in the Supabase dashboard. Cached per warm function instance.
let bucketReady: Promise<boolean> | null = null;
function ensureBucket(): Promise<boolean> {
  if (!bucketReady) {
    bucketReady = (async () => {
      const got = await fetch(`${storageBase()}/bucket/${BUCKET}`, {
        headers: authHeaders(),
      });
      if (got.ok) return true;
      const made = await fetch(`${storageBase()}/bucket`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          id: BUCKET,
          name: BUCKET,
          public: false,
          file_size_limit: MAX_IMAGE_BYTES,
          allowed_mime_types: ALLOWED_TYPES,
        }),
      });
      if (made.ok) return true;
      const text = (await made.text()).slice(0, 200);
      // Another instance may have created it between our two calls.
      if (/already exists/i.test(text)) return true;
      console.error(`Kunne ikke lage bildemappen (HTTP ${made.status}): ${text}`);
      return false;
    })().catch((err) => {
      console.error("Kunne ikke lage bildemappen:", (err as Error).message);
      return false;
    });
    // Don't cache a failure — try again on the next request.
    bucketReady.then((ok) => {
      if (!ok) bucketReady = null;
    });
  }
  return bucketReady;
}

// Accepts a data URL, uploads it as a file. Returns an HTTP status for the
// endpoint to pass on: 204 ok, 400 bad input, 413 too big, 500 storage error.
export async function uploadImage(
  vippsSub: string,
  storyId: string,
  key: string,
  dataUrl: unknown
): Promise<number> {
  if (!supabaseReady()) return 503;
  if (typeof dataUrl !== "string") return 400;
  const match = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match || !ALLOWED_TYPES.includes(match[1])) return 400;
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length === 0) return 400;
  if (bytes.length > MAX_IMAGE_BYTES) return 413;
  if (!(await ensureBucket())) return 500;
  try {
    const r = await fetch(
      `${storageBase()}/object/${BUCKET}/${objectPath(vippsSub, storyId, key)}`,
      {
        method: "POST",
        headers: {
          ...authHeaders(),
          "Content-Type": match[1],
          "x-upsert": "true",
        },
        body: bytes,
      }
    );
    if (!r.ok) {
      console.error(
        `Bildeopplasting feilet (HTTP ${r.status}): ${(await r.text()).slice(0, 200)}`
      );
      return 500;
    }
    return 204;
  } catch (err) {
    console.error("Bildeopplasting feilet:", (err as Error).message);
    return 500;
  }
}

// One round-trip for every image in the list. Returns key -> signed URL for
// the ones that worked; missing images simply render as "no picture".
export async function signImages(
  vippsSub: string,
  items: Array<{ storyId: string; key: string }>
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!supabaseReady() || items.length === 0) return out;
  const paths = items.map((i) => objectPath(vippsSub, i.storyId, i.key));
  try {
    const r = await fetch(`${storageBase()}/object/sign/${BUCKET}`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: SIGNED_URL_SECONDS, paths }),
    });
    if (!r.ok) {
      console.error(
        `Signering av bilder feilet (HTTP ${r.status}): ${(await r.text()).slice(0, 200)}`
      );
      return out;
    }
    const rows = (await r.json()) as Array<{
      path?: string;
      signedURL?: string | null;
      error?: string | null;
    }>;
    rows.forEach((row, idx) => {
      if (row.signedURL) {
        out.set(paths[idx], encodeURI(`${storageBase()}${row.signedURL}`));
      }
    });
  } catch (err) {
    console.error("Signering av bilder feilet:", (err as Error).message);
  }
  return out;
}

export const signedUrlFor = (
  signed: Map<string, string>,
  vippsSub: string,
  storyId: string,
  key: string
) => signed.get(objectPath(vippsSub, storyId, key));

// Best-effort cleanup when a story is deleted.
export async function deleteStoryImages(
  vippsSub: string,
  storyId: string
): Promise<void> {
  if (!supabaseReady()) return;
  try {
    const prefix = objectPath(vippsSub, storyId);
    const list = await fetch(`${storageBase()}/object/list/${BUCKET}`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ prefix, limit: 100, offset: 0 }),
    });
    if (!list.ok) return;
    const files = (await list.json()) as Array<{ name?: string }>;
    const prefixes = files
      .map((f) => f.name)
      .filter((n): n is string => Boolean(n))
      .map((n) => `${prefix}/${n}`);
    if (prefixes.length === 0) return;
    const del = await fetch(`${storageBase()}/object/${BUCKET}`, {
      method: "DELETE",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes }),
    });
    if (!del.ok) {
      console.error(
        `Sletting av bilder feilet (HTTP ${del.status}): ${(await del.text()).slice(0, 200)}`
      );
    }
  } catch (err) {
    console.error("Sletting av bilder feilet:", (err as Error).message);
  }
}
