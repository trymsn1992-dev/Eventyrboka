// What a family has made themselves and wants to use again: heroes drawn
// from a photo, and morals they typed. Kept on the account in the table
// `samling` (see supabase/schema.sql), one row per thing.
//
// If the table has not been created yet, every call fails quietly: the
// browser's own copy of the last hero still works, like before.
import { createHash } from "node:crypto";
import { supabaseKey, supabaseReady, supabaseUrl } from "./supabase.js";
import { isCustomMetaphor, mayPersonalize } from "./access.js";
import type { Session } from "./session.js";

export type ItemType = "helt" | "laerepenge";

export interface Item {
  id: string;
  type: ItemType;
  data: Record<string, unknown>;
}

// How many of each an account may keep.
export const MAX_ITEMS: Record<ItemType, number> = { helt: 12, laerepenge: 20 };

const headers = (prefer: string): Record<string, string> => {
  const key = supabaseKey();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: prefer,
  };
};

// The same thing saved twice by the same user lands on the same row.
export const itemId = (vippsSub: string, type: ItemType, key: string): string =>
  createHash("sha256").update(`${vippsSub}|${type}|${key}`).digest("hex").slice(0, 40);

export const heroItemId = (vippsSub: string, token: string): string =>
  itemId(vippsSub, "helt", token);
export const moralItemId = (vippsSub: string, text: string): string =>
  itemId(vippsSub, "laerepenge", text.toLowerCase());

export const validItemId = (id: unknown): id is string =>
  typeof id === "string" && /^[a-f0-9]{40}$/.test(id);

const table = () => `${supabaseUrl()}/rest/v1/samling`;
const owner = (vippsSub: string) => `vipps_sub=eq.${encodeURIComponent(vippsSub)}`;

// Everything the user has saved, newest first. null when it can't be read.
export async function listItems(vippsSub: string): Promise<Item[] | null> {
  if (!supabaseReady() || !vippsSub) return null;
  try {
    const r = await fetch(
      `${table()}?${owner(vippsSub)}&select=id,type,data&order=opprettet.desc`,
      { headers: headers("return=representation") }
    );
    if (!r.ok) {
      console.error(
        `Supabase-henting av samling feilet (HTTP ${r.status}). Er supabase/schema.sql kjørt? ${(
          await r.text()
        ).slice(0, 200)}`
      );
      return null;
    }
    return ((await r.json()) as Item[]).filter(
      (row) => row && typeof row.data === "object" && row.data !== null
    );
  } catch (err) {
    console.error("Supabase-henting av samling feilet:", (err as Error).message);
    return null;
  }
}

// Saves one thing. "full" when the account already keeps MAX_ITEMS of the kind.
export async function saveItem(
  vippsSub: string,
  type: ItemType,
  id: string,
  data: Record<string, unknown>
): Promise<"ok" | "full" | "error"> {
  if (!supabaseReady() || !vippsSub) return "error";
  try {
    const existing = await fetch(
      `${table()}?${owner(vippsSub)}&type=eq.${type}&select=id`,
      { headers: headers("return=representation") }
    );
    if (!existing.ok) return "error";
    const ids = ((await existing.json()) as Array<{ id: string }>).map((row) => row.id);
    if (!ids.includes(id) && ids.length >= MAX_ITEMS[type]) return "full";

    const r = await fetch(`${table()}?on_conflict=id`, {
      method: "POST",
      headers: headers("resolution=merge-duplicates,return=minimal"),
      body: JSON.stringify({ id, vipps_sub: vippsSub, type, data }),
    });
    if (!r.ok) {
      console.error(
        `Supabase-lagring i samling feilet (HTTP ${r.status}): ${(await r.text()).slice(0, 200)}`
      );
      return "error";
    }
    return "ok";
  } catch (err) {
    console.error("Supabase-lagring i samling feilet:", (err as Error).message);
    return "error";
  }
}

export async function deleteItem(vippsSub: string, id: string): Promise<boolean> {
  if (!supabaseReady() || !vippsSub || !validItemId(id)) return false;
  try {
    const r = await fetch(`${table()}?id=eq.${id}&${owner(vippsSub)}`, {
      method: "DELETE",
      headers: headers("return=minimal"),
    });
    return r.ok;
  } catch (err) {
    console.error("Supabase-sletting i samling feilet:", (err as Error).message);
    return false;
  }
}

async function hasItem(vippsSub: string, id: string): Promise<boolean> {
  if (!supabaseReady() || !vippsSub) return false;
  try {
    const r = await fetch(`${table()}?id=eq.${id}&${owner(vippsSub)}&select=id`, {
      headers: headers("return=representation"),
    });
    return r.ok && ((await r.json()) as unknown[]).length > 0;
  } catch {
    return false;
  }
}

// Does this story need magic («Magihistorie»)? Making a new hero or typing a
// new moral does. One that is already kept on the account does not: it was
// made in a magic story once, and is free to use again.
export async function needsMagic(
  session: Session | null,
  options: { metaphor: string; heroToken?: string }
): Promise<boolean> {
  const custom = isCustomMetaphor(options.metaphor);
  if (!custom && !options.heroToken) return false;
  if (!session) return true;
  const [heroSaved, moralSaved] = await Promise.all([
    options.heroToken ? hasItem(session.sub, heroItemId(session.sub, options.heroToken)) : true,
    custom ? hasItem(session.sub, moralItemId(session.sub, options.metaphor)) : true,
  ]);
  return !(heroSaved && moralSaved);
}

// May this request use the hero and moral it names? Yes in a magic story or
// on Prinsen, and yes when they are already kept on the account.
export async function mayUseOwn(
  session: Session | null,
  ticket: unknown,
  options: { metaphor: string; heroToken?: string }
): Promise<boolean> {
  if (!isCustomMetaphor(options.metaphor) && !options.heroToken) return true;
  if (await mayPersonalize(session, ticket)) return true;
  return !(await needsMagic(session, options));
}
