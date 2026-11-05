import { StoryOptions, StorySegment, StoryPlan } from "../types";

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let message = "Noe gikk galt.";
    try {
      const data = await response.json();
      if (data && typeof data.error === "string") message = data.error;
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

export const planStory = async (
  options: StoryOptions
): Promise<StoryPlan> => {
  return postJson<StoryPlan>("/api/plan", { options });
};

export const generateCharacterSheet = async (
  character: string
): Promise<string | undefined> => {
  try {
    const { base64 } = await postJson<{ base64: string | null }>(
      "/api/character-sheet",
      { character }
    );
    return base64 ?? undefined;
  } catch (error) {
    console.warn("Character sheet failed:", error);
    return undefined;
  }
};

// Returns only the text + choices + illustration prompt. No image yet — let the
// UI render the page as soon as this resolves so the reader is not left waiting
// on the slower image call.
export const startNewStoryText = async (
  options: StoryOptions,
  plan?: StoryPlan
): Promise<StorySegment> => {
  return postJson<StorySegment>("/api/story", { options, plan });
};

export const continueStoryText = async (
  options: StoryOptions,
  previousSegments: StorySegment[],
  choiceSummary: string,
  plan?: StoryPlan,
  forceEnding?: boolean
): Promise<StorySegment> => {
  const trimmed = previousSegments.map((s) => ({ text: s.text }));
  return postJson<StorySegment>("/api/story", {
    options,
    previousSegments: trimmed,
    choiceSummary,
    plan,
    forceEnding,
  });
};

// Generates the illustration for a segment. Pass the plan so the image call can
// use the character reference sheet and side-character bibles. Awaits a lazily
// resolved character sheet promise so the sheet doesn't block the text path.
export const generateIllustration = async (
  segment: StorySegment,
  options: StoryOptions,
  plan: StoryPlan | undefined,
  characterSheet: string | undefined
): Promise<string | undefined> => {
  if (!segment.illustrationPrompt) return undefined;
  try {
    const { base64 } = await postJson<{ base64: string | null }>("/api/image", {
      prompt: segment.illustrationPrompt,
      character: options.character,
      characterSheet,
      sideCharacters: plan?.sideCharacters ?? [],
    });
    return base64 ?? undefined;
  } catch (error) {
    console.warn("Illustration failed:", error);
    return undefined;
  }
};

// Fast opener: the tiny first-page call made by the lite model. Writes
// side 1 only — text, two choices with bridges and an illustration
// prompt — so the reader sees something within ~3-5s while the heavier
// /api/book call writes the rest in parallel.
export const generateOpener = async (
  options: StoryOptions
): Promise<StorySegment> => {
  return postJson<StorySegment>("/api/opener", { options });
};

// Generates the full book (plan + pages with text, choices, bridges and
// illustration prompts) in a single Gemini call.
//
// When `opener` is supplied, the server knows side 1 has already been
// written (by generateOpener). It then returns a plan plus pages 2..N
// as a continuation of that opener. The caller is responsible for
// prepending the opener as segment 0.
//
// When `opener` is omitted, the server writes the full book (all N
// pages) as the standalone one-shot flow.
export interface GeneratedBook {
  plan: Omit<StoryPlan, "characterSheetBase64">;
  pages: StorySegment[];
}
export const generateFullBook = async (
  options: StoryOptions,
  opener?: { text: string }
): Promise<GeneratedBook> => {
  const data = await postJson<{
    plan: GeneratedBook["plan"];
    pages: Array<{
      text: string;
      isEnding: boolean;
      illustrationPrompt: string;
      choices: Array<{ text: string; nextPlotPoint: string; bridge: string }>;
    }>;
  }>("/api/book", { options, opener });
  return {
    plan: data.plan,
    pages: data.pages.map((p) => ({
      text: p.text,
      choices: p.choices,
      isEnding: p.isEnding,
      illustrationPrompt: p.illustrationPrompt,
    })),
  };
};

export const generateSpeech = async (
  text: string
): Promise<string | undefined> => {
  try {
    const { base64 } = await postJson<{ base64: string | null }>(
      "/api/speech",
      { text }
    );
    return base64 ?? undefined;
  } catch (error) {
    console.error("Speech failed:", error);
    return undefined;
  }
};
