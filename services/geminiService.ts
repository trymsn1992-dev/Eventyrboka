import { Choice, SideCharacter, StoryOptions, StorySegment } from "../types";

// What lets the story on screen be read aloud (see api/_lib/access.ts): the
// pass it got when a wish was spent on read-aloud, together with the story's
// key — or, for a «Magihistorie» from before wishes, its old ticket.
export interface ReadAloudAccess {
  storyKey: string;
  pass?: string;
  legacyTicket?: string;
}
let readAloud: ReadAloudAccess | null = null;
export const setReadAloudAccess = (access: ReadAloudAccess | null): void => {
  readAloud = access;
};

export async function postJson<T>(url: string, body: unknown): Promise<T> {
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
  artStyle?: string,
  // Set when the hero was made from a photo (see services/hero.ts).
  heroToken?: string
): Promise<string | undefined> => {
  try {
    const { base64 } = await postJson<{ base64: string | null }>(
      "/api/character-sheet",
      { character, artStyle, heroToken }
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
      {
        prompt: segment.illustrationPrompt,
        character: options.character,
        heroToken: options.heroToken,
        artStyle: options.artStyle,
        characterSheet,
        sideCharacters,
      }
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
  seed: number
): Promise<{
  segment: StorySegment;
  premise: string;
  guest: boolean;
  // How many wishes it cost, and whether any of them was a bought one.
  wishes: number;
  bought: boolean;
}> => {
  const data = await postJson<
    PageResponse & {
      premise?: string;
      sideCharacters?: SideCharacter[];
      gjest?: boolean;
      onsker?: number;
      kjopt?: boolean;
    }
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
    // The server saw no login: the story can be read, and saved after a login.
    guest: data.gjest === true,
    wishes: typeof data.onsker === "number" ? data.onsker : 0,
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
    const { base64 } = await postJson<{ base64: string | null }>("/api/speech", {
      text,
      historie: readAloud?.storyKey,
      lesepass: readAloud?.pass,
      billett: readAloud?.legacyTicket,
    });
    return base64 ?? undefined;
  } catch (error) {
    console.error("Speech failed:", error);
    return undefined;
  }
};

// Spend a wish on read-aloud of one story. Resolves to the pass that lets it
// be read aloud from now on; throws with a message for the reader otherwise.
export const buyReadAloud = async (storyKey: string): Promise<string> => {
  const { lesepass } = await postJson<{ lesepass: string }>("/api/speech", {
    kjop: true,
    historie: storyKey,
  });
  return lesepass;
};
