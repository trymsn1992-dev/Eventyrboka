import {
  CHARACTERS,
  METAPHORS,
  THEMES,
  GENRES,
  AGE_GROUPS,
  DURATIONS,
  StoryOptions,
} from "../../types";

// Older client bundles and saved stories reference these legacy duration
// labels. Accept them so a stale cache or an old saved story still works.
const LEGACY_DURATIONS = [
  "Kort (ca. 2,5 min)",
  "Middels (ca. 5 min)",
  "Lang (ca. 10 min)",
  "Ekstra lang (ca. 15 min)",
];

const ALLOWED = {
  character: new Set(CHARACTERS),
  metaphor: new Set(METAPHORS),
  theme: new Set(THEMES),
  genre: new Set(GENRES),
  ageGroup: new Set(AGE_GROUPS),
  duration: new Set([...DURATIONS, ...LEGACY_DURATIONS]),
};

export function validateOptions(options: unknown): StoryOptions | null {
  if (!options || typeof options !== "object") return null;
  const o = options as Record<string, unknown>;
  if (
    typeof o.character !== "string" ||
    typeof o.metaphor !== "string" ||
    typeof o.theme !== "string" ||
    typeof o.genre !== "string" ||
    typeof o.ageGroup !== "string" ||
    typeof o.duration !== "string"
  ) {
    return null;
  }
  if (
    !ALLOWED.character.has(o.character) ||
    !ALLOWED.metaphor.has(o.metaphor) ||
    !ALLOWED.theme.has(o.theme) ||
    !ALLOWED.genre.has(o.genre) ||
    !ALLOWED.ageGroup.has(o.ageGroup) ||
    !ALLOWED.duration.has(o.duration)
  ) {
    return null;
  }
  return {
    character: o.character,
    metaphor: o.metaphor,
    theme: o.theme,
    genre: o.genre,
    ageGroup: o.ageGroup,
    duration: o.duration,
  };
}
