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

// The setup choices a user wants remembered (age group and reading length).
// Lives in brukere.innstillinger. If that column hasn't been added yet (see
// supabase/schema.sql), both calls fail quietly and the browser's own copy
// is used instead.
export type Preferences = Record<string, string>;

export async function getPreferences(vippsSub: string): Promise<Preferences> {
  if (!supabaseReady() || !vippsSub) return {};
  try {
    const r = await fetch(
      `${supabaseUrl()}/rest/v1/brukere?vipps_sub=eq.${encodeURIComponent(
        vippsSub
      )}&select=innstillinger`,
      { headers: headers() }
    );
    if (!r.ok) return {};
    const rows = (await r.json()) as Array<{ innstillinger?: unknown }>;
    const v = rows[0]?.innstillinger;
    return v && typeof v === "object" ? (v as Preferences) : {};
  } catch {
    return {};
  }
}

export async function savePreferences(
  vippsSub: string,
  prefs: Preferences
): Promise<boolean> {
  if (!supabaseReady() || !vippsSub) return false;
  try {
    const r = await fetch(
      `${supabaseUrl()}/rest/v1/brukere?vipps_sub=eq.${encodeURIComponent(vippsSub)}`,
      {
        method: "PATCH",
        headers: { ...headers(), Prefer: "return=minimal" },
        body: JSON.stringify({ innstillinger: prefs }),
      }
    );
    if (!r.ok) {
      console.error(
        `Supabase-lagring av innstillinger feilet (HTTP ${r.status}): ${(
          await r.text()
        ).slice(0, 200)}`
      );
    }
    return r.ok;
  } catch (err) {
    console.error("Supabase-lagring av innstillinger feilet:", (err as Error).message);
    return false;
  }
}

// The account row: the plan the user is on and their saved setup choices.
// If the plan column hasn't been added yet (see supabase/schema.sql) the
// plan reads as "not chosen".
export interface Account {
  plan: "gratis" | "pro" | null;
  innstillinger: Preferences;
}

export async function getAccount(vippsSub: string): Promise<Account> {
  const empty: Account = { plan: null, innstillinger: {} };
  if (!supabaseReady() || !vippsSub) return empty;
  try {
    const r = await fetch(
      `${supabaseUrl()}/rest/v1/brukere?vipps_sub=eq.${encodeURIComponent(
        vippsSub
      )}&select=innstillinger,plan`,
      { headers: headers() }
    );
    if (!r.ok) return { plan: null, innstillinger: await getPreferences(vippsSub) };
    const rows = (await r.json()) as Array<{ innstillinger?: unknown; plan?: unknown }>;
    const row = rows[0];
    if (!row) return empty;
    return {
      plan: row.plan === "pro" || row.plan === "gratis" ? row.plan : null,
      innstillinger:
        row.innstillinger && typeof row.innstillinger === "object"
          ? (row.innstillinger as Preferences)
          : {},
    };
  } catch {
    return empty;
  }
}

export async function setPlan(
  vippsSub: string,
  plan: "gratis" | "pro"
): Promise<boolean> {
  if (!supabaseReady() || !vippsSub) return false;
  try {
    const r = await fetch(
      `${supabaseUrl()}/rest/v1/brukere?vipps_sub=eq.${encodeURIComponent(vippsSub)}`,
      {
        method: "PATCH",
        headers: { ...headers(), Prefer: "return=representation" },
        body: JSON.stringify({ plan }),
      }
    );
    if (!r.ok) {
      console.error(
        `Supabase-lagring av plan feilet (HTTP ${r.status}): ${(await r.text()).slice(0, 200)}`
      );
      return false;
    }
    // No row updated means the user row is missing — treat as not saved.
    return ((await r.json()) as unknown[]).length > 0;
  } catch (err) {
    console.error("Supabase-lagring av plan feilet:", (err as Error).message);
    return false;
  }
}

// Calls one of the functions in supabase/schema.sql. Returns null when it
// can't be reached, so the caller decides what that means.
export async function quotaRpc<T>(
  fn: "bruk_ukeskvote" | "les_ukeskvote" | "bruk_kjop" | "logg_innsikt",
  args: Record<string, unknown>
): Promise<T | null> {
  if (!supabaseReady()) return null;
  try {
    const r = await fetch(`${supabaseUrl()}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(args),
    });
    if (!r.ok) {
      console.error(
        `Supabase-funksjonen ${fn} svarte HTTP ${r.status}. Er supabase/schema.sql kjørt? ${(
          await r.text()
        ).slice(0, 200)}`
      );
      return null;
    }
    return (await r.json()) as T;
  } catch (err) {
    console.error(`Supabase-funksjonen ${fn} feilet:`, (err as Error).message);
    return null;
  }
}

// Plain table access for the payment tables (kjop, avtaler). `query` is a
// PostgREST filter such as "referanse=eq.abc". Rows on success, null on failure.
export async function tableRequest<T>(
  method: "GET" | "POST" | "PATCH",
  table: "kjop" | "avtaler",
  query: string,
  body?: Record<string, unknown>
): Promise<T[] | null> {
  if (!supabaseReady()) return null;
  try {
    const r = await fetch(`${supabaseUrl()}/rest/v1/${table}${query ? `?${query}` : ""}`, {
      method,
      headers: { ...headers(), Prefer: "return=representation" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) {
      console.error(
        `Supabase ${method} ${table} svarte HTTP ${r.status}. Er supabase/schema.sql kjørt? ${(
          await r.text()
        ).slice(0, 200)}`
      );
      return null;
    }
    return (await r.json()) as T[];
  } catch (err) {
    console.error(`Supabase ${method} ${table} feilet:`, (err as Error).message);
    return null;
  }
}
