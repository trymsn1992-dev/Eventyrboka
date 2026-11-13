import { Choice, SideCharacter, StoryOptions, StorySegment } from "../types";

// The ticket of the story on screen, when it is a «Magihistorie» made on the
// free plan (see api/_lib/access.ts). Sent along with that story's requests.
let storyTicket: string | null = null;
export const setStoryTicket = (ticket: string | null): void => {
  storyTicket = ticket;
};
const withTicket = <B extends object>(body: B): B | (B & { billett: string }) =>
  storyTicket ? { ...body, billett: storyTicket } : body;

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
  character: string,
  artStyle?: string
): Promise<string | undefined> => {
  try {
    const { base64 } = await postJson<{ base64: string | null }>(
      "/api/character-sheet",
      withTicket({ character, artStyle })
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
    const { base64 } = await postJson<{ base64: string | null }>(
      "/api/image",
      withTicket({
        prompt: segment.illustrationPrompt,
        character: options.character,
        artStyle: options.artStyle,
        characterSheet,
        sideCharacters,
      })
    );
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
  seed: number,
  // Ask for a «Magihistorie» (own moral, chosen drawing style, read-aloud).
  personal: boolean
): Promise<{
  segment: StorySegment;
  premise: string;
  guest: boolean;
  ticket: string | null;
  // Paid for with a bought story, not one of the week's free ones.
  bought: boolean;
}> => {
  const data = await postJson<
    PageResponse & {
      premise?: string;
      sideCharacters?: SideCharacter[];
      gjest?: boolean;
      billett?: string;
      kjopt?: boolean;
    }
  >("/api/opener", { options, seed, personlig: personal });
  return {
    segment: {
      text: data.text,
      choices: data.choices,
      isEnding: false,
      illustrationPrompt: data.illustrationPrompt,
      sideCharacters: data.sideCharacters ?? [],
    },
    premise: data.premise ?? "",
    // The server saw no login: the story stops at GUEST_PAGES until there is one.
    guest: data.gjest === true,
    ticket: typeof data.billett === "string" ? data.billett : null,
    bought: data.kjopt === true,
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
    withTicket({
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
    })
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
      withTicket({ text })
    );
    return base64 ?? undefined;
  } catch (error) {
    console.error("Speech failed:", error);
    return undefined;
  }
};
