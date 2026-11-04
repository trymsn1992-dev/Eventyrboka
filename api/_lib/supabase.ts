// Supabase REST client. The service key stays on the server — never shipped
// to the browser. Row-level security is not relied on; access is gated by
// our own signed session cookie (see session.ts).
import type { SavedStory } from "../../types.js";

const v = (name: string) => (process.env[name] || "").trim();

export const supabaseUrl = () => v("SUPABASE_URL");
export const supabaseKey = () => v("SUPABASE_SERVICE_KEY");

export const supabaseReady = (): boolean =>
  Boolean(supabaseUrl() && supabaseKey());

function headers(): Record<string, string> {
  const key = supabaseKey();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

// Upsert the user row on each login. Stores only vipps_sub, fornavn and
// the last login timestamp — no email, no phone, nothing else.
export async function recordLogin(
  vippsSub: string,
  fornavn: string
): Promise<void> {
  if (!supabaseReady() || !vippsSub) return;
  try {
    const r = await fetch(`${supabaseUrl()}/rest/v1/brukere`, {
      method: "POST",
      headers: {
        ...headers(),
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        vipps_sub: vippsSub,
        fornavn: fornavn || null,
        siste_innlogging: new Date().toISOString(),
      }),
    });
    if (!r.ok) {
      console.error(
        `Supabase-lagringen av brukeren feilet (HTTP ${r.status}): ${(
          await r.text()
        ).slice(0, 200)}`
      );
    }
  } catch (err) {
    console.error(
      "Supabase-lagringen av brukeren feilet:",
      (err as Error).message
    );
  }
}

export interface StoredStory {
  id: string;
  data: SavedStory;
  opprettet: string;
  oppdatert: string;
}

// Returns every story the user has saved, newest first. An empty array
// means either no stories or Supabase is unavailable — the client treats
// both the same way (shows "ingen lagrede historier").
export async function listStories(vippsSub: string): Promise<SavedStory[]> {
  if (!supabaseReady() || !vippsSub) return [];
  try {
    const r = await fetch(
      `${supabaseUrl()}/rest/v1/fortellinger?vipps_sub=eq.${encodeURIComponent(
        vippsSub
      )}&select=data&order=opprettet.desc`,
      { headers: headers() }
    );
    if (!r.ok) return [];
    const rows = (await r.json()) as Array<{ data: SavedStory }>;
    return rows.map((row) => row.data);
  } catch (err) {
    console.error("Supabase-henting feilet:", (err as Error).message);
    return [];
  }
}

// Upsert one story by id. We trust the client's id (it's a UUID generated
// client-side), but scope it to the logged-in vipps_sub so one user can
// never overwrite another's story even if they guess an id.
export async function upsertStory(
  vippsSub: string,
  story: SavedStory
): Promise<boolean> {
  if (!supabaseReady() || !vippsSub || !story?.id) return false;
  try {
    const nowIso = new Date().toISOString();
    const r = await fetch(
      `${supabaseUrl()}/rest/v1/fortellinger?on_conflict=id`,
      {
        method: "POST",
        headers: {
          ...headers(),
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify({
          id: story.id,
          vipps_sub: vippsSub,
          data: story,
          opprettet: new Date(story.createdAt || Date.now()).toISOString(),
          oppdatert: nowIso,
        }),
      }
    );
    if (!r.ok) {
      console.error(
        `Supabase-lagring av fortelling feilet (HTTP ${r.status}): ${(
          await r.text()
        ).slice(0, 200)}`
      );
    }
    return r.ok;
  } catch (err) {
    console.error("Supabase-lagring av fortelling feilet:", (err as Error).message);
    return false;
  }
}

export async function deleteStory(
  vippsSub: string,
  id: string
): Promise<boolean> {
  if (!supabaseReady() || !vippsSub || !id) return false;
  try {
    const r = await fetch(
      `${supabaseUrl()}/rest/v1/fortellinger?id=eq.${encodeURIComponent(
        id
      )}&vipps_sub=eq.${encodeURIComponent(vippsSub)}`,
      { method: "DELETE", headers: { ...headers(), Prefer: "return=minimal" } }
    );
    if (!r.ok) {
      console.error(
        `Supabase-sletting feilet (HTTP ${r.status}): ${(await r.text()).slice(
          0,
          200
        )}`
      );
    }
    return r.ok;
  } catch (err) {
    console.error("Supabase-sletting feilet:", (err as Error).message);
    return false;
  }
}
