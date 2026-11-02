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
