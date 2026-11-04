// Account state and story sync for the logged-in user. When no one is signed in
// — the common path while Vipps is still being set up — every call falls back
// to the local IndexedDB store, so the app keeps working as it did before.
import { SavedStory } from "../types";
import {
  deleteStoryFromDB,
  getAllStoriesFromDB,
  saveStoryToDB,
} from "./storage";

export interface AccountStatus {
  // The server's /api/meg has answered at least once.
  checked: boolean;
  // /api/vipps/start will actually work (env vars in place).
  vippsReady: boolean;
  // Supabase is reachable, so stories can be synced for the logged-in user.
  supabaseReady: boolean;
  innlogget: boolean;
  fornavn: string;
}

export const emptyStatus = (): AccountStatus => ({
  checked: false,
  vippsReady: false,
  supabaseReady: false,
  innlogget: false,
  fornavn: "",
});

// /api/meg is slow (cold start) or down when env vars are missing, so we
// time it out and fall back to "no account" instead of leaving the UI
// stuck without a sign-in button.
export async function fetchStatus(timeoutMs = 3500): Promise<AccountStatus> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch("/api/meg", {
      credentials: "same-origin",
      signal: controller.signal,
    });
    if (!r.ok) return { ...emptyStatus(), checked: true };
    const data = (await r.json()) as {
      vippsKlar?: boolean;
      supabaseKlar?: boolean;
      innlogget?: boolean;
      fornavn?: string;
    };
    return {
      checked: true,
      vippsReady: Boolean(data.vippsKlar),
      supabaseReady: Boolean(data.supabaseKlar),
      innlogget: Boolean(data.innlogget),
      fornavn: data.fornavn || "",
    };
  } catch {
    return { ...emptyStatus(), checked: true };
  } finally {
    clearTimeout(timer);
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch("/api/loggut", {
      method: "POST",
      credentials: "same-origin",
    });
  } catch {
    // Ignore — the cookie expires on its own in 30 days anyway.
  }
}

// Load every story the user has. Logged in → Supabase (and we migrate any
// IndexedDB leftovers up on the way in). Logged out → IndexedDB.
export async function loadStories(innlogget: boolean): Promise<SavedStory[]> {
  if (!innlogget) return getAllStoriesFromDB();
  // One-shot migration: any story still sitting in IndexedDB after login
  // gets pushed to Supabase and removed locally, so stories don't appear
  // or disappear depending on which browser the user is on.
  try {
    const local = await getAllStoriesFromDB();
    for (const s of local) {
      const ok = await saveStoryRemote(s);
      if (ok) await deleteStoryFromDB(s.id);
    }
  } catch (err) {
    console.warn("Kunne ikke flytte lokale historier til kontoen:", err);
  }
  const r = await fetch("/api/stories", { credentials: "same-origin" });
  if (!r.ok) return [];
  const list = (await r.json()) as SavedStory[];
  return list.sort((a, b) => b.createdAt - a.createdAt);
}

async function saveStoryRemote(story: SavedStory): Promise<boolean> {
  const r = await fetch("/api/stories", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(story),
  });
  return r.ok;
}

export async function saveStory(
  story: SavedStory,
  innlogget: boolean
): Promise<boolean> {
  if (!innlogget) {
    await saveStoryToDB(story);
    return true;
  }
  const ok = await saveStoryRemote(story);
  // Mirror locally, so the story is still there if the user goes offline or
  // signs out later.
  if (ok) {
    try {
      await saveStoryToDB(story);
    } catch {
      // Not fatal — the server has it.
    }
  }
  return ok;
}

export async function deleteStory(
  id: string,
  innlogget: boolean
): Promise<boolean> {
  // Always clear the local copy so the UI is consistent across sign-out.
  try {
    await deleteStoryFromDB(id);
  } catch {
    // Ignore — if it wasn't there, that's fine.
  }
  if (!innlogget) return true;
  const r = await fetch(`/api/stories?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  return r.ok;
}
