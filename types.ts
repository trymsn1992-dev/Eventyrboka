
export interface StoryOptions {
  character: string;
  metaphor: string;
  ageGroup: string;
  duration: string;
  // Drawing style for the illustrations (one of ART_STYLES). Missing on
  // stories saved before the choice existed — those are watercolour.
  artStyle?: string;
  // A hero made from a photo of a toy or a drawing (see api/figur.ts). The
  // token is signed by the server and holds what the hero looks like and is
  // like; `character` is then the name the family gave it.
  heroToken?: string;
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
  // Legacy: stories written before choices had real consequences showed this
  // sentence after the click. No longer generated.
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
  // Index into `choices` of the option the reader picked on this page.
  // Written when the story is saved, so re-reading shows "Valgt sist".
  // -1 means a grown-up used "Avslutt historien på neste side" here.
  chosenIndex?: number;
  // Named side characters introduced on this page (with visual bibles), so
  // later pages and illustrations keep them consistent along this path.
  sideCharacters?: SideCharacter[];
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
  // Legacy one-shot stories carried a full plan.
  plan?: StoryPlan;
  // What the story is about (from page 1) and the seed every page was written
  // with — needed to write a new branch when re-reading picks the other option.
  premise?: string;
  seed?: number;
  // Started without a login and not yet counted as anyone's story: only
  // the first GUEST_PAGES pages can be read until it is.
  guestStarted?: boolean;
  // A «Magihistorie» made on the free plan carries the server's ticket for
  // it, so read-aloud and its drawing style keep working when it is re-read.
  personalTicket?: string;
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

// A little personality for each hero. `tagline` is shown on the hero card;
// `personality` goes into the story prompts so the hero sounds like
// themselves on every page.
export const CHARACTER_TRAITS: Record<string, { tagline: string; personality: string }> = {
  "Ninja-katten Nils": {
    tagline: "Modig og lynrask – men redd for vann",
    personality:
      "Modig, ivrig og rask som lynet, men litt for utålmodig. Sniker seg på tå selv når det ikke trengs. Redd for å bli våt. Roper gjerne «Hai-ja!».",
  },
  "Kongekrabba Kim": {
    tagline: "Høytidelig konge som elsker å danse",
    personality:
      "Høytidelig og litt selvhøytidelig konge som egentlig er kjempesnill. Går alltid sidelengs, elsker å danse, og klipper med klørne når han er glad. Sier gjerne «Kongelig klipp-klapp!».",
  },
  "Rom-hunden Rex": {
    tagline: "Nysgjerrig oppdager som snuser på alt",
    personality:
      "Nysgjerrig, glad og logrende. Må snuse på alt som er nytt, og blir lett distrahert av ting som svever forbi. Sier gjerne «Voff og vekk!».",
  },
  "Prinsesse Pølse": {
    tagline: "Tøff prinsesse med masse humor",
    personality:
      "Selvsikker, morsom og litt sjefete, men raus og varm. Elsker fest og fine ting, og liker ikke å bli kalt liten. Sier «Du store sennep!» når hun blir overrasket.",
  },
  "Dragen Dagros": {
    tagline: "Snill og litt sjenert – bjella klinger når hun ler",
    personality:
      "Snill, rolig og litt sjenert. Sier «mø» når hun tenker seg om, og kubjella klinger når hun ler. Elsker blomster og vil at alle skal ha det bra.",
  },
  "Super-sneglen Sivert": {
    tagline: "Treig, men gir aldri opp",
    personality:
      "Tålmodig og evig optimist. Veldig, veldig treg, men tror selv at han er lynrask. Gir aldri opp. Sier gjerne «Sakte, men super!».",
  },
};

// A hero the family made themselves from a photo. Only the server can read
// the token; the rest is for showing the hero in the picker.
export interface OwnHero {
  name: string;
  tagline: string;
  token: string;
  // The character sheet drawn from the photo (data URL), and the drawing
  // style it was drawn in.
  sheet: string;
  artStyle: string;
}

// The name of a hero made from a photo ends up in the story prompts, so
// only letters, digits, spaces and hyphens get through: 2-24 characters.
export const HERO_NAME_MAX = 24;
export function cleanHeroName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const cleaned = input
    .replace(/[^\p{L}\p{N} \-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, HERO_NAME_MAX)
    .trim();
  return cleaned.length >= 2 ? cleaned : null;
}

// A few words from the family about what their own hero is like ("elsker
// pannekaker, litt redd for mørket"). Optional. Cleaned like a typed moral.
export const HERO_TRAITS_MAX = 120;
export function cleanHeroTraits(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const cleaned = input
    .replace(/[^\p{L}\p{N} ,.!?'’:()\-–]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, HERO_TRAITS_MAX)
    .trim();
  return cleaned.length >= 3 ? cleaned : null;
}

export const METAPHORS = [
  "Det lønner seg å dele",
  "Fokuser på det du kan påvirke",
  "Vær snill mot andre",
  "Det lønner seg å spare",
  "Vær mot andre slik du vil at andre skal være mot deg",
  "Ærlighet varer lengst"
];

// Drawing styles the reader can pick between. The prompt for each lives in
// api/_lib/gemini.ts; the first one is the default.
export const ART_STYLES = [
  "Akvarell",
  "Fargestifter",
  "Papirklipp",
  "Tegnefilm"
];
export const DEFAULT_ART_STYLE = ART_STYLES[0];

// A grown-up can type their own moral instead of picking one. It ends up
// inside the story prompts, so only plain text of a sensible length gets
// through: letters, digits and simple punctuation, 3-80 characters.
export const CUSTOM_METAPHOR_MAX = 80;
export function cleanCustomMetaphor(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const cleaned = input
    .replace(/[^\p{L}\p{N} ,.!?'’:()\-–]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CUSTOM_METAPHOR_MAX)
    .trim();
  return cleaned.length >= 3 ? cleaned : null;
}

// Plans. In the database and the code they are "gratis" and "pro"; to the
// user they are Askeladden and Prinsen.
//  - Askeladden: free stories each week, then pay per story.
//  - Prinsen: a weekly price, no commitment, everything included.
// There are two kinds of story. To the user they are «Vanlig historie» and
// «Magihistorie»; in the code the second one is "personal": your own moral, a
// chosen drawing style and read-aloud. Each week Askeladden gets two of the
// first kind or one of the second for free. Payment is not built yet — the
// prices are shown, and Prinsen is given through a share link.
export type Plan = "gratis" | "pro";
export const PLAN_NAMES: Record<Plan, string> = { gratis: "Askeladden", pro: "Prinsen" };
export const STORY_NAME = "Vanlig historie";
export const PERSONAL_STORY_NAME = "Magihistorie";
// The names inside a sentence: "2 vanlige historier", "1 magihistorie".
export const storyCount = (n: number, personal = false): string =>
  personal
    ? `${n} ${n === 1 ? "magihistorie" : "magihistorier"}`
    : `${n} ${n === 1 ? "vanlig historie" : "vanlige historier"}`;
// The week's free stories, counted in plain stories. A personal one uses all of them.
export const FREE_STORIES_PER_WEEK = 2;
export const PRICE_SIMPLE_STORY_KR = 10;
export const PRICE_PERSONAL_STORY_KR = 20;
export const PRICE_PRINSEN_PER_WEEK_KR = 20;

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
// Pages that can be read without logging in: page 1 and the page behind its
// choice. The choice on page 2 needs a login.
export const GUEST_PAGES = 2;

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
