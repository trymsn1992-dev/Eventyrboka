
export interface StoryOptions {
  character: string;
  metaphor: string;
  ageGroup: string;
  duration: string;
  // Legacy fields kept optional so saved stories from older versions still load.
  // No longer collected from the user — the planner picks setting and genre naturally.
  theme?: string;
  genre?: string;
}

export interface Choice {
  text: string;
  nextPlotPoint: string;
  // 1-2 sentence continuation shown on the CURRENT page right after this
  // choice is picked. Keeps the reader occupied while the next page generates,
  // and makes the chosen path feel like a real consequence instead of a jump.
  bridge?: string;
}

export interface StorySegment {
  text: string;
  choices: Choice[];
  isEnding: boolean;
  illustrationPrompt?: string;
  imageBase64?: string; // Added to store the generated image
  // Set on stories saved to the account: the illustration lives in Supabase
  // Storage under this key ("side-<index>"), and imageBase64 is then a
  // short-lived signed URL rather than a data URL.
  imageKey?: string;
}

export interface StoryBeat {
  // Short label for the beat ("Åpning", "Møte med dilemma", "Vendepunkt", "Klimaks", "Slutt")
  label: string;
  // One or two sentences describing what happens at this beat (the beat MUST happen on every branch)
  summary: string;
  // The dilemma that drives the choice on this page. Omitted for the final resolution page.
  choicePrompt?: string;
  // True for the single beat that puts the metaphor on trial — the moral core of the story.
  isMetaphorTest?: boolean;
}

// A recurring named side character. Bible is a thorough visual description used in image prompts.
export interface SideCharacter {
  name: string;
  bible: string;
}

export interface StoryPlan {
  // One-sentence hook describing the whole arc
  logline: string;
  // 2-3 sentence character voice/personality sketch to lock in consistency
  characterVoice: string;
  // Exactly CHOICE_PAGES structural beats, in order. The last beat is the resolution (no choice).
  beats: StoryBeat[];
  // How the metaphor is tested and resolved
  moralArc: string;
  // 2-3 sensory world details so segments share a consistent setting
  settingSeeds: string[];
  // 0-3 named side characters the plan expects to recur, with full visual bibles.
  sideCharacters: SideCharacter[];
  // Canonical character sheet image for the main character (base64 data URL).
  // Sent as a reference image to every subsequent illustration call to lock the look.
  characterSheetBase64?: string;
}

export interface SavedStory {
  id: string;
  createdAt: number;
  options: StoryOptions;
  segments: StorySegment[];
  plan?: StoryPlan;
}

export interface StoryState {
  segments: StorySegment[];
  isLoading: boolean;
  isComplete: boolean;
  error: string | null;
}

export const CHARACTERS = [
  "Ninja-katten Nils",
  "Kongekrabba Kim",
  "Rom-hunden Rex",
  "Prinsesse Pølse",
  "Dragen Dagros",
  "Super-sneglen Sivert"
];

export const METAPHORS = [
  "Det lønner seg å dele",
  "Fokuser på det du kan påvirke",
  "Vær snill mot andre",
  "Det lønner seg å spare",
  "Vær mot andre slik du vil at andre skal være mot deg",
  "Ærlighet varer lengst"
];

export const AGE_GROUPS = [
  "Småbarn (1-3 år)",
  "3-4 år",
  "4-5 år",
  "6-8 år"
];

// Older saved stories used split age groups. Accept them on the backend
// and map them to the merged "Småbarn (1-3 år)" when loaded.
export const LEGACY_AGE_GROUPS = ["1-2 år", "2-3 år"];

export function normalizeAgeGroup(input: string | undefined): string {
  if (!input) return AGE_GROUPS[1];
  if (input === "1-2 år" || input === "2-3 år") return AGE_GROUPS[0];
  return input;
}

export const DURATIONS = [
  "Kort (ca. 2,5 min)",
  "Middels (ca. 5 min)",
  "Lang (ca. 10 min)"
];

// Every story now has a fixed number of choice pages + one resolution page.
// Duration no longer controls page count — it controls density on each page.
export const CHOICE_PAGES = 4;
export const TOTAL_PAGES = CHOICE_PAGES + 1; // 4 choice beats + 1 resolution

export interface DurationDensity {
  // Approximate sentences per page (string so model reads it as a range)
  sentences: string;
  // Mini-scenes (small self-contained moments) BEFORE the choice on each page.
  miniScenes: number;
  // Short Norwegian label for the model about pacing.
  pacing: string;
}

// Density entries exist for the current DURATIONS and for the legacy
// "· N sider" labels still present in older saved stories. All variants map to
// the same density — the length of the sider-labels was descriptive only.
export const DURATION_DENSITY: Record<string, DurationDensity> = {
  "Kort (ca. 2,5 min)": {
    sentences: "3-5",
    miniScenes: 0,
    pacing: "stramt og raskt — rett på handlingen, ingen mini-scener før valget",
  },
  "Middels (ca. 5 min)": {
    sentences: "6-10",
    miniScenes: 1,
    pacing: "rolig — én kort mini-scene (observasjon, dialog eller sanselig øyeblikk) før valget",
  },
  "Lang (ca. 10 min)": {
    sentences: "12-18",
    miniScenes: 2,
    pacing: "fyldig — to mini-scener som bygger stemning og karakter før valget",
  },
};

// Kept for backward compatibility with code that references it.
// Every duration maps to the same fixed page count now.
export const DURATION_ESTIMATES: Record<string, number> = {
  "Kort (ca. 2,5 min)": TOTAL_PAGES,
  "Middels (ca. 5 min)": TOTAL_PAGES,
  "Lang (ca. 10 min)": TOTAL_PAGES,
};
