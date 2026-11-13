// A hero the family makes themselves from a photo of a toy or a drawing.
// The photo is scaled down here, sent to /api/figur, and never stored. What
// comes back — the drawn character sheet and a signed description — is kept
// in this browser, so the hero can be used again in later stories.
import { DEFAULT_ART_STYLE, OwnHero } from "../types";
import { compressImage } from "./account";
import { postJson } from "./geminiService";

const KEY = "magiboka_egen_helt";
// Longest side of the photo that is sent. Plenty for the model to see the
// toy, and far below the size limit of a request.
const PHOTO_MAX_PX = 1024;

// The picked file as a small JPEG data URL.
export async function preparePhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    // The load event rather than decode(): decode() can wait for a frame
    // that never comes when the page is in the background.
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("bilde"));
      img.src = url;
    });
    const scale = Math.min(1, PHOTO_MAX_PX / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const jpeg = canvas.toDataURL("image/jpeg", 0.85);
    if (!jpeg.startsWith("data:image/jpeg")) throw new Error("jpeg");
    return jpeg;
  } catch {
    throw new Error("Vi klarte ikke å åpne bildet. Prøv et annet.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Draws the hero. Takes 15-30 seconds. Throws with a message for the reader
// when the photo can't be used (for example a photo of a person).
export async function makeHero(
  photo: string,
  name: string,
  artStyle: string | undefined,
  // A few words about what the hero is like, if the family wrote any.
  traits?: string
): Promise<OwnHero> {
  const data = await postJson<{
    navn: string;
    undertittel: string;
    token: string;
    ark: string;
    artStyle: string;
  }>("/api/figur", { bilde: photo, navn: name, karakter: traits, artStyle });
  return {
    name: data.navn,
    tagline: data.undertittel,
    token: data.token,
    sheet: data.ark,
    artStyle: data.artStyle || DEFAULT_ART_STYLE,
  };
}

const isOwnHero = (x: unknown): x is OwnHero => {
  if (!x || typeof x !== "object") return false;
  const h = x as Record<string, unknown>;
  return (
    typeof h.name === "string" &&
    typeof h.tagline === "string" &&
    typeof h.token === "string" &&
    typeof h.sheet === "string" &&
    h.sheet.startsWith("data:image/") &&
    typeof h.artStyle === "string"
  );
};

// The hero as it came from the server, until the page is reloaded: its
// sheet is sharper than the stored copy, and it is there even when the
// browser's storage isn't.
let current: OwnHero | null = null;

export function loadOwnHero(): OwnHero | null {
  if (current) return current;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    return isOwnHero(raw) ? raw : null;
  } catch {
    return null;
  }
}

// Keeps the hero for later stories (one at a time; a new one replaces it).
// The sheet is made smaller first so it fits in the browser's storage.
export async function saveOwnHero(hero: OwnHero): Promise<void> {
  current = hero;
  try {
    const sheet = await compressImage(hero.sheet);
    localStorage.setItem(KEY, JSON.stringify({ ...hero, sheet }));
  } catch {
    // Private mode or no room — the hero still works for this story.
  }
}

// A hero picked from the account's saved ones: the one the next story uses.
export function selectOwnHero(hero: OwnHero): void {
  current = hero;
}

export function forgetOwnHero(): void {
  current = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to remove.
  }
}
