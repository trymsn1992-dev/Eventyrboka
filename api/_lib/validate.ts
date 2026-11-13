import {
  CHARACTERS,
  METAPHORS,
  AGE_GROUPS,
  ART_STYLES,
  LEGACY_AGE_GROUPS,
  DURATIONS,
  cleanCustomMetaphor,
  normalizeAgeGroup,
  StoryOptions,
} from "../../types.js";
import { openHero } from "./hero.js";

// Older client bundles may still ship these legacy duration labels.
// Accept them so a stale browser cache keeps working after we rename.
const LEGACY_DURATIONS = [
  "Kort (ca. 2,5 min · 5 sider)",
  "Middels (ca. 5 min · 8 sider)",
  "Lang (ca. 10 min · 15 sider)",
];

const ALLOWED = {
  character: new Set(CHARACTERS),
  metaphor: new Set(METAPHORS),
  ageGroup: new Set([...AGE_GROUPS, ...LEGACY_AGE_GROUPS]),
  duration: new Set([...DURATIONS, ...LEGACY_DURATIONS]),
};

export function validateOptions(options: unknown): StoryOptions | null {
  if (!options || typeof options !== "object") return null;
  const o = options as Record<string, unknown>;
  if (
    typeof o.character !== "string" ||
    typeof o.metaphor !== "string" ||
    typeof o.ageGroup !== "string" ||
    typeof o.duration !== "string"
  ) {
    return null;
  }
  // The hero is one of ours, or one made from a photo: then the signed token
  // says who it is, and the name comes from the token.
  const hero = o.heroToken === undefined ? null : openHero(o.heroToken);
  if (o.heroToken !== undefined && !hero) return null;
  if (
    (!hero && !ALLOWED.character.has(o.character)) ||
    !ALLOWED.ageGroup.has(o.ageGroup) ||
    !ALLOWED.duration.has(o.duration)
  ) {
    return null;
  }
  // One of ours, or a moral the grown-up typed themselves (cleaned).
  const metaphor = ALLOWED.metaphor.has(o.metaphor)
    ? o.metaphor
    : cleanCustomMetaphor(o.metaphor);
  if (!metaphor) return null;
  return {
    character: hero ? hero.name : o.character,
    ...(hero ? { heroToken: o.heroToken as string } : {}),
    metaphor,
    ageGroup: normalizeAgeGroup(o.ageGroup),
    duration: o.duration,
    ...(typeof o.artStyle === "string" && ART_STYLES.includes(o.artStyle)
      ? { artStyle: o.artStyle }
      : {}),
  };
}
