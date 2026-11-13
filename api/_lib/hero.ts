// A hero the family made themselves from a photo of a toy or a drawing
// (see api/figur.ts). What it looks like and is like is written once, by the
// model, and signed into a token. The client keeps the token and sends it
// along with the story, so nothing the client typed freely — other than the
// cleaned name — ends up in the prompts.
import { openCookie, sealCookie } from "./session.js";
import { CHARACTER_DESCRIPTIONS } from "./gemini.js";
import type { StoryOptions } from "../../types.js";

export interface Hero {
  // The name the family gave it ("Bamse").
  name: string;
  // What it is, in Norwegian, for the story prompts ("en brun bamse med rød sløyfe").
  kind: string;
  // Norwegian personality sketch, like CHARACTER_TRAITS.
  personality: string;
  // English visual bible, like CHARACTER_DESCRIPTIONS.
  bible: string;
}

// Saved stories keep the token, so it lasts as long as a story might be re-read.
const LIFETIME_SEC = 5 * 365 * 24 * 60 * 60;

export const sealHero = (hero: Hero): string =>
  sealCookie("figur", { ...hero }, LIFETIME_SEC);

export function openHero(token: unknown): Hero | null {
  if (typeof token !== "string" || token.length > 12_000) return null;
  try {
    const h = openCookie<Hero>("figur", token);
    if (
      !h ||
      typeof h.name !== "string" ||
      typeof h.kind !== "string" ||
      typeof h.personality !== "string" ||
      typeof h.bible !== "string"
    ) {
      return null;
    }
    return { name: h.name, kind: h.kind, personality: h.personality, bible: h.bible };
  } catch {
    return null;
  }
}

// How the hero is named in a story prompt: one of ours by name, an own hero
// by name and what it is.
export function heroLabel(options: StoryOptions): string {
  const hero = openHero(options.heroToken);
  return hero ? `${hero.name} (${hero.kind})` : options.character;
}

// The visual bible for the image prompts: an own hero's, or one of ours.
export function heroBible(character: unknown, heroToken: unknown): string | null {
  const hero = openHero(heroToken);
  if (hero) return hero.bible;
  return (typeof character === "string" && CHARACTER_DESCRIPTIONS[character]) || null;
}
