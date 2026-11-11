import { Choice, SideCharacter, StoryOptions, StorySegment } from "../types";

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

// Generates the illustration for a page. The character sheet locks the main
// character's look; side-character bibles lock everyone else's.
export const generateIllustration = async (
  segment: StorySegment,
  options: StoryOptions,
  sideCharacters: SideCharacter[],
  characterSheet: string | undefined
): Promise<string | undefined> => {
  if (!segment.illustrationPrompt) return undefined;
  try {
    const { base64 } = await postJson<{ base64: string | null }>("/api/image", {
      prompt: segment.illustrationPrompt,
      character: options.character,
      characterSheet,
      sideCharacters,
    });
    return base64 ?? undefined;
  } catch (error) {
    console.warn("Illustration failed:", error);
    return undefined;
  }
};

interface PageResponse {
  text: string;
  choices: Choice[];
  isEnding: boolean;
  illustrationPrompt: string;
}

// Page 1, written fast (~3-5 s). `seed` is shared with every later page of
// the same story; `premise` is the problem the whole story is about.
export const generateOpener = async (
  options: StoryOptions,
  seed: number
): Promise<{ segment: StorySegment; premise: string }> => {
  const data = await postJson<
    PageResponse & { premise?: string; sideCharacters?: SideCharacter[] }
  >("/api/opener", { options, seed });
  return {
    segment: {
      text: data.text,
      choices: data.choices,
      isEnding: false,
      illustrationPrompt: data.illustrationPrompt,
      sideCharacters: data.sideCharacters ?? [],
    },
    premise: data.premise ?? "",
  };
};

export interface PageRequest {
  options: StoryOptions;
  seed: number;
  premise: string;
  // The pages so far, each with the choice the reader made on it. The last
  // entry's choice is the one this new page follows (none for a wrap-up).
  path: Array<{ text: string; choice?: Choice }>;
  sideCharacters: SideCharacter[];
  // A grown-up pressed "Avslutt historien på neste side".
  forceEnding?: boolean;
}

// The next page behind one choice. Called for both choices while the reader
// is still on the current page.
export const generatePage = async (req: PageRequest): Promise<StorySegment> => {
  const data = await postJson<PageResponse & { newSideCharacters?: SideCharacter[] }>(
    "/api/side",
    {
      options: req.options,
      seed: req.seed,
      premise: req.premise,
      pages: req.path.map((p) => ({
        text: p.text,
        choice: p.choice?.text,
        choiceDirection: p.choice?.nextPlotPoint,
      })),
      sideCharacters: req.sideCharacters,
      forceEnding: req.forceEnding === true,
    }
  );
  return {
    text: data.text,
    choices: data.choices,
    isEnding: data.isEnding,
    illustrationPrompt: data.illustrationPrompt,
    sideCharacters: data.newSideCharacters ?? [],
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
