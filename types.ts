
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

export interface SavedStory {
  id: string;
  createdAt: number;
  options: StoryOptions;
  segments: StorySegment[];
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
  "6-8 år",
  "30+"
];

export const DURATIONS = [
  "Kort (ca. 2,5 min)",
  "Middels (ca. 5 min)",
  "Lang (ca. 10 min)",
  "Ekstra lang (ca. 15 min)"
];

export const DURATION_ESTIMATES: Record<string, number> = {
  "Kort (ca. 2,5 min)": 5,
  "Middels (ca. 5 min)": 8,
  "Lang (ca. 10 min)": 15,
  "Ekstra lang (ca. 15 min)": 25
};
