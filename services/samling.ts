// What the family has made themselves and can pick again: heroes drawn from
// a photo, and morals they typed. Kept on the account (/api/samling), so they
// follow the login to every device. Without a login there is nothing here —
// the last hero made still lives in the browser (services/hero.ts).
import { OwnHero, cleanCustomMetaphor } from "../types";
import { compressImage } from "./account";
import { forgetOwnHero, loadOwnHero } from "./hero";

export interface SavedMoral {
  id?: string;
  text: string;
}

export interface Collection {
  heroes: OwnHero[];
  morals: SavedMoral[];
}

const empty = (): Collection => ({ heroes: [], morals: [] });

// One copy for the whole page, so the setup page and Min side agree.
let cache: Collection | null = null;
let loading: Promise<Collection> | null = null;

const isHero = (x: unknown): x is OwnHero => {
  if (!x || typeof x !== "object") return false;
  const h = x as Record<string, unknown>;
  return (
    typeof h.name === "string" &&
    typeof h.token === "string" &&
    typeof h.sheet === "string" &&
    h.sheet.startsWith("data:image/")
  );
};

async function fetchCollection(): Promise<Collection> {
  try {
    const r = await fetch("/api/samling", { credentials: "same-origin" });
    if (!r.ok) return empty();
    const data = (await r.json()) as { helter?: unknown; laerepenger?: unknown };
    const heroes = (Array.isArray(data.helter) ? data.helter : []).filter(isHero).map((h) => ({
      id: typeof h.id === "string" ? h.id : undefined,
      name: h.name,
      tagline: typeof h.tagline === "string" ? h.tagline : "",
      token: h.token,
      sheet: h.sheet,
      artStyle: typeof h.artStyle === "string" ? h.artStyle : "",
    }));
    const morals: SavedMoral[] = [];
    for (const m of Array.isArray(data.laerepenger) ? data.laerepenger : []) {
      const row = m as { id?: unknown; tekst?: unknown };
      const text = cleanCustomMetaphor(row?.tekst);
      if (text) morals.push({ id: typeof row.id === "string" ? row.id : undefined, text });
    }
    return { heroes, morals };
  } catch {
    return empty();
  }
}

// The collection as last seen, without asking the server.
export const cachedCollection = (): Collection => cache ?? empty();

// Everything saved on the account. On Prinsen a hero that so far only lives
// in this browser is moved up on the way, so it is there on the next device
// too (for others it is kept the first time it is used in a magic story).
export function loadCollection(loggedIn: boolean): Promise<Collection> {
  if (!loggedIn) {
    cache = null;
    loading = null;
    return Promise.resolve(empty());
  }
  if (cache) return Promise.resolve(cache);
  if (!loading) {
    loading = fetchCollection().then(async (collection) => {
      cache = collection;
      const local = loadOwnHero();
      if (local && !collection.heroes.some((h) => h.token === local.token)) {
        await saveHeroToProfile(local);
      }
      loading = null;
      return cache ?? collection;
    });
  }
  return loading;
}

async function post(body: unknown): Promise<string | null> {
  try {
    const r = await fetch("/api/samling", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) return null;
    const data = (await r.json()) as { id?: unknown };
    return typeof data.id === "string" ? data.id : null;
  } catch {
    return null;
  }
}

// Keeps a hero on the account, so it can be picked again — also in a plain
// story. Making one is magic: the server only takes it from inside a
// «Magihistorie» (`ticket` is that story's) or on Prinsen.
export async function saveHeroToProfile(hero: OwnHero, ticket?: string | null): Promise<void> {
  if (cache?.heroes.some((h) => h.token === hero.token && h.id)) return;
  // A smaller drawing is plenty for the picker and as the illustrator's reference.
  const sheet = await compressImage(hero.sheet, 768);
  const id = await post({
    helt: { token: hero.token, sheet, tagline: hero.tagline, artStyle: hero.artStyle },
    ...(ticket ? { billett: ticket } : {}),
  });
  if (!id) return;
  const current = cache ?? empty();
  cache = {
    ...current,
    heroes: [{ ...hero, id }, ...current.heroes.filter((h) => h.token !== hero.token)],
  };
}

// Keeps a typed moral on the account, on the same terms as a hero.
export async function saveMoralToProfile(text: string, ticket?: string | null): Promise<void> {
  if (cache?.morals.some((m) => m.text.toLowerCase() === text.toLowerCase())) return;
  const id = await post({ laerepenge: text, ...(ticket ? { billett: ticket } : {}) });
  if (!id) return;
  const current = cache ?? empty();
  cache = { ...current, morals: [{ id, text }, ...current.morals] };
}

async function remove(id: string | undefined): Promise<void> {
  if (!id) return;
  try {
    await fetch(`/api/samling?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
  } catch {
    // Still gone from this page; it comes back on reload if the server kept it.
  }
}

export async function removeHero(hero: OwnHero): Promise<void> {
  if (cache) cache = { ...cache, heroes: cache.heroes.filter((h) => h.token !== hero.token) };
  if (loadOwnHero()?.token === hero.token) forgetOwnHero();
  await remove(hero.id);
}

export async function removeMoral(moral: SavedMoral): Promise<void> {
  if (cache) cache = { ...cache, morals: cache.morals.filter((m) => m.text !== moral.text) };
  await remove(moral.id);
}
