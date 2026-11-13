// One row per story in our own database (table `innsikt`), so we can see how
// far people read, what they pick and how many stars they give — and combine
// those, which the Vercel events cannot. See api/innsikt.ts.
//
// The row is about the story, not the reader: no user id, no name, and never
// anything typed by the user (a custom moral is stored as "Egen").
import { DEFAULT_ART_STYLE, METAPHORS, StoryOptions } from "../types";

interface Current {
  id: string;
  startedAt: number;
  page: number;
}

// Kept in localStorage so a guest story keeps its row through the trip to
// Vipps and back (which reloads the page, sometimes in a new tab).
const KEY = "magiboka_innsikt";
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

let current: Current | null = null;

const remember = () => {
  try {
    if (current) localStorage.setItem(KEY, JSON.stringify(current));
    else localStorage.removeItem(KEY);
  } catch {
    // Private mode: the row just stops at the login.
  }
};

const newId = (): string | null => {
  try {
    return crypto.randomUUID();
  } catch {
    return null;
  }
};

function send(fields: Record<string, string | number | boolean>): void {
  if (!current) return;
  try {
    void fetch("/api/innsikt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: current.id,
        sekunder: Math.round((Date.now() - current.startedAt) / 1000),
        ...fields,
      }),
      // Still sent when the tab is closed right after.
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Measurement must never break the app.
  }
}

// A new story is on screen (page 1).
export function insightStarted(
  options: StoryOptions,
  about: { personal: boolean; who: "gjest" | "askeladden" | "prinsen"; bought: boolean }
): void {
  const id = newId();
  if (!id) {
    current = null;
    return;
  }
  current = { id, startedAt: Date.now(), page: 1 };
  remember();
  send({
    helt: options.character,
    moral: METAPHORS.includes(options.metaphor) ? options.metaphor : "Egen",
    alder: options.ageGroup,
    stil: options.artStyle ?? DEFAULT_ART_STYLE,
    lengde: options.duration,
    type: about.personal ? "magi" : "vanlig",
    hvem: about.who,
    kjopt: about.bought,
    enhet: window.matchMedia("(max-width: 767px)").matches ? "mobil" : "pc",
    sider: 1,
  });
}

// A new page was reached. `choices`: what was picked on the pages before it
// (0 or 1; -1 = the grown-up ended the story).
export function insightPage(page: number, choices: number[], ending: boolean, endedEarly: boolean): void {
  if (!current) return;
  current.page = Math.max(current.page, page);
  remember();
  send({
    sider: current.page,
    valg: choices.join(","),
    ...(ending ? { ferdig: true, avsluttet_tidlig: endedEarly } : {}),
  });
}

// The guest who started the story logged in to read on.
export function insightLoggedIn(): void {
  send({ logget_inn: true });
}

export function insightRated(stars: number): void {
  send({ stjerner: stars });
}

export function insightSaved(): void {
  send({ lagret: true });
}

export function insightReadAloud(): void {
  send({ les_hoyt: true });
}

// Back from the login: carry on with the row of the story that was waiting.
export function insightResume(): void {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    current =
      raw && typeof raw.id === "string" && typeof raw.startedAt === "number" && Date.now() - raw.startedAt < MAX_AGE_MS
        ? { id: raw.id, startedAt: raw.startedAt, page: Number(raw.page) || 1 }
        : null;
  } catch {
    current = null;
  }
}

// The story on screen is not a new one (a saved story, or none at all).
export function insightStop(): void {
  current = null;
  remember();
}
