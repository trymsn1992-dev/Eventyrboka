import { StoryOptions, StorySegment } from "../types";

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
  character: string
): Promise<StorySegment> {
  if (!segment.illustrationPrompt) return segment;
  try {
    const { base64 } = await postJson<{ base64: string | null }>("/api/image", {
      prompt: segment.illustrationPrompt,
      character,
    });
    if (base64) segment.imageBase64 = base64;
  } catch (error) {
    console.warn("Illustration failed:", error);
  }
  return segment;
}

export const startNewStory = async (
  options: StoryOptions
): Promise<StorySegment> => {
  const segment = await postJson<StorySegment>("/api/story", { options });
  return attachIllustration(segment, options.character);
};

export const continueStory = async (
  options: StoryOptions,
  previousSegments: StorySegment[],
  choiceSummary: string
): Promise<StorySegment> => {
  const trimmed = previousSegments.map((s) => ({ text: s.text }));
  const segment = await postJson<StorySegment>("/api/story", {
    options,
    previousSegments: trimmed,
    choiceSummary,
  });
  return attachIllustration(segment, options.character);
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
