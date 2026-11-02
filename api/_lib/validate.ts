import {
  CHARACTERS,
  METAPHORS,
  AGE_GROUPS,
  LEGACY_AGE_GROUPS,
  DURATIONS,
  normalizeAgeGroup,
  StoryOptions,
} from "../../types.js";

// Older client bundles and saved stories reference these legacy duration
// labels. Accept them so a stale cache or an old saved story still works.
const LEGACY_DURATIONS = [
  "Kort (ca. 2,5 min · 5 sider)",
  "Middels (ca. 5 min · 8 sider)",
  "Lang (ca. 10 min · 15 sider)",
  "Ekstra lang (ca. 15 min · 25 sider)",
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
  if (
    !ALLOWED.character.has(o.character) ||
    !ALLOWED.metaphor.has(o.metaphor) ||
    !ALLOWED.ageGroup.has(o.ageGroup) ||
    !ALLOWED.duration.has(o.duration)
  ) {
    return null;
  }
  return {
    character: o.character,
    metaphor: o.metaphor,
    ageGroup: normalizeAgeGroup(o.ageGroup),
    duration: o.duration,
  };
}
