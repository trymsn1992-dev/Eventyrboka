
export interface StoryOptions {
  character: string;
  metaphor: string;
  theme: string;
  genre: string;
  ageGroup: string;
  duration: string;
}

export interface Choice {
  text: string;
  nextPlotPoint: string;
}

export interface StorySegment {
  text: string;
  choices: Choice[];
  isEnding: boolean;
  illustrationPrompt?: string;
  imageBase64?: string; // Added to store the generated image
}

export interface StoryBeat {
  // Short label for the beat ("Åpning", "Møte med dilemma", "Vendepunkt", "Klimaks", "Slutt")
  label: string;
  // One sentence describing what happens at this beat
  summary: string;
}

export interface StoryPlan {
  // One-sentence hook describing the whole arc
  logline: string;
  // 2-3 sentence character voice/personality sketch to lock in consistency
  characterVoice: string;
  // 3-6 structural beats spread across the story
  beats: StoryBeat[];
  // How the metaphor is tested and resolved
  moralArc: string;
  // 2-3 sensory world details so segments share a consistent setting
  settingSeeds: string[];
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
  "Vær modig selv om du er redd",
  "Ærlighet varer lengst"
];

export const THEMES = [
  "Fjelltur",
  "Fotballkamp",
  "Bursdag",
  "Dugnad",
  "Skattejakt",
  "Romreise",
  "Undervannseventyr",
  "Sirkus"
];

export const GENRES = [
  "Spenning",
  "Humor",
  "Mysterium",
  "Eventyr"
];

export const AGE_GROUPS = [
  "1-2 år",
  "2-3 år",
  "3-4 år",
  "4-5 år",
  "6-8 år"
];

export const DURATIONS = [
  "Kort (ca. 2,5 min · 5 sider)",
  "Middels (ca. 5 min · 8 sider)",
  "Lang (ca. 10 min · 15 sider)",
  "Ekstra lang (ca. 15 min · 25 sider)"
];

export const DURATION_ESTIMATES: Record<string, number> = {
  "Kort (ca. 2,5 min · 5 sider)": 5,
  "Middels (ca. 5 min · 8 sider)": 8,
  "Lang (ca. 10 min · 15 sider)": 15,
  "Ekstra lang (ca. 15 min · 25 sider)": 25
};
