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

async function attachIllustration(
  segment: StorySegment,
  options: StoryOptions,
  plan: StoryPlan | undefined
): Promise<StorySegment> {
  if (!segment.illustrationPrompt) return segment;
  try {
    const { base64 } = await postJson<{ base64: string | null }>("/api/image", {
      prompt: segment.illustrationPrompt,
      character: options.character,
      characterSheet: plan?.characterSheetBase64,
      sideCharacters: plan?.sideCharacters ?? [],
    });
    if (base64) segment.imageBase64 = base64;
  } catch (error) {
    console.warn("Illustration failed:", error);
  }
  return segment;
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

export const startNewStory = async (
  options: StoryOptions,
  plan?: StoryPlan
): Promise<StorySegment> => {
  const segment = await postJson<StorySegment>("/api/story", {
    options,
    plan,
  });
  return attachIllustration(segment, options, plan);
};

export const continueStory = async (
  options: StoryOptions,
  previousSegments: StorySegment[],
  choiceSummary: string,
  plan?: StoryPlan
): Promise<StorySegment> => {
  const trimmed = previousSegments.map((s) => ({ text: s.text }));
  const segment = await postJson<StorySegment>("/api/story", {
    options,
    previousSegments: trimmed,
    choiceSummary,
    plan,
  });
  return attachIllustration(segment, options, plan);
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
