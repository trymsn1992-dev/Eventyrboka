// Insight in our own database, so we can see how far people read, what they
// pick, how long they wait and what they pay for — and combine those, which
// the Vercel events cannot. See api/innsikt.ts and supabase/schema.sql.
//
//  - One row per story (table `innsikt`).
//  - One row per event outside the story (table `innsikt_hendelser`): visits,
//    locks, the plan page, purchases.
//
// Nothing says who the reader is: no user id, no name, and never anything
// typed by the user (a custom moral or hero is stored as "Egen").
import { DEFAULT_ART_STYLE, METAPHORS, StoryOptions } from "../types";

type Who = "gjest" | "askeladden" | "prinsen";
type Fields = Record<string, string | number | boolean>;

interface Current {
  id: string;
  startedAt: number;
  page: number;
  // Waiting time in ms for each page after the first.
  waits: number[];
  errors: number;
  // Pages turned before their picture had arrived.
  noImage: number;
}

// Kept in localStorage so a guest story keeps its row through the trip to
// Vipps and back (which reloads the page, sometimes in a new tab).
const KEY = "magiboka_innsikt";
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

let current: Current | null = null;
let who: Who = "gjest";

const remember = () => {
  try {
    if (current) localStorage.setItem(KEY, JSON.stringify(current));
    else localStorage.removeItem(KEY);
  } catch {
    // Private mode: the row just stops at the login.
  }
};

function post(body: Fields): void {
  try {
    void fetch("/api/innsikt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      // Still sent when the tab is closed or leaves for Vipps right after.
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Measurement must never break the app.
  }
}

function send(fields: Fields): void {
  if (!current) return;
  post({
    id: current.id,
    sekunder: Math.round((Date.now() - current.startedAt) / 1000),
    ...fields,
  });
}

// ---------------------------------------------------------------------------
// Where the visitor came from: utm_source, or else the site that linked here.
// The first one seen is kept for 30 days, so a purchase next week still
// counts for the place that brought the reader in.

const SOURCE_KEY = "magiboka_kilde";
const SOURCE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const VISIT_KEY = "magiboka_besok";
const VISIT_GAP_MS = 30 * 60 * 1000;
const KNOWN_SITES = [
  "facebook", "instagram", "google", "bing", "tiktok", "snapchat", "linkedin",
  "youtube", "pinterest", "reddit", "duckduckgo", "messenger",
];

const tidy = (value: string | null): string =>
  (value ?? "").toLowerCase().replace(/[^a-z0-9æøå._-]/g, "").slice(0, 40);

function readSource(): { kilde: string; kampanje?: string } {
  const params = new URLSearchParams(window.location.search);
  let kilde = tidy(params.get("utm_source"));
  const kampanje = tidy(params.get("utm_campaign"));
  if (!kilde) {
    let host = "";
    try {
      host = document.referrer ? new URL(document.referrer).hostname.toLowerCase() : "";
    } catch {
      host = "";
    }
    // Our own pages and the way back from Vipps are not a source.
    if (!host || host === window.location.hostname || host.includes("vipps")) kilde = "direkte";
    else if (host === "t.co" || host.includes("twitter") || host === "x.com") kilde = "x";
    else kilde = KNOWN_SITES.find((site) => host.includes(site)) ?? tidy(host.replace(/^www\./, ""));
  }
  return kampanje ? { kilde: kilde || "direkte", kampanje } : { kilde: kilde || "direkte" };
}

let source: { kilde: string; kampanje?: string } = { kilde: "direkte" };

// Call once when the app starts, before anything is logged.
export function captureSource(): void {
  try {
    const seen = readSource();
    const kept = JSON.parse(localStorage.getItem(SOURCE_KEY) || "null");
    const keptOk =
      kept && typeof kept.kilde === "string" && typeof kept.at === "number" && Date.now() - kept.at < SOURCE_MAX_AGE_MS;
    // A campaign link always counts; otherwise the first source stays.
    if (keptOk && !(seen.kampanje || (kept.kilde === "direkte" && seen.kilde !== "direkte"))) {
      source = kept.kampanje ? { kilde: kept.kilde, kampanje: kept.kampanje } : { kilde: kept.kilde };
    } else {
      source = seen;
      localStorage.setItem(SOURCE_KEY, JSON.stringify({ ...seen, at: Date.now() }));
    }
  } catch {
    // Private mode: this visit only.
    try {
      source = readSource();
    } catch {
      source = { kilde: "direkte" };
    }
  }
  // One visit per half hour of use, across tabs: a page that is loaded twice
  // (a second tab, a preloaded copy, the way back from Vipps) is the same visit.
  try {
    const last = Number(localStorage.getItem(VISIT_KEY)) || 0;
    localStorage.setItem(VISIT_KEY, String(Date.now()));
    if (Date.now() - last < VISIT_GAP_MS) return;
  } catch {
    // Private mode: counted anyway.
  }
  insightEvent("Besøk", { enhet: device() });
}

const device = () => (window.matchMedia("(max-width: 767px)").matches ? "mobil" : "pc");

// ---------------------------------------------------------------------------
// Events outside the story.

// Who is reading: kept up to date by the app.
export function insightWho(now: Who): void {
  who = now;
}

// Already on the story's own row.
const STORY_EVENTS = new Set([
  "Eventyr startet", "Eventyr innstillinger", "Eventyr lengde", "Historietype",
  "Side lest", "Eventyr ferdig", "Vurdering", "Les høyt", "Eventyr lagret",
]);

// Every logEvent() comes through here (see analytics.ts). The first value of
// the event is kept as its detail.
export function insightEvent(name: string, data?: Record<string, string | number | boolean | null>): void {
  if (STORY_EVENTS.has(name)) return;
  const first = data ? Object.values(data)[0] : null;
  post({
    hendelse: name,
    ...(first === null || first === undefined ? {} : { detalj: String(first) }),
    hvem: who,
    ...source,
  });
}

// ---------------------------------------------------------------------------
// The story on screen.

// «Start» was pressed: the story is being made. The row is there from now,
// so we also see the ones that never arrive.
export function insightBegin(options: StoryOptions, personal: boolean): void {
  let id: string;
  try {
    id = crypto.randomUUID();
  } catch {
    current = null;
    return;
  }
  current = { id, startedAt: Date.now(), page: 0, waits: [], errors: 0, noImage: 0 };
  remember();
  send({
    // The name of a hero the family made themselves stays with them.
    helt: options.heroToken ? "Egen" : options.character,
    moral: METAPHORS.includes(options.metaphor) ? options.metaphor : "Egen",
    alder: options.ageGroup,
    stil: options.artStyle ?? DEFAULT_ART_STYLE,
    lengde: options.duration,
    type: personal ? "magi" : "vanlig",
    hvem: who,
    enhet: device(),
    sider: 0,
    ...source,
  });
}

// Page 1 is on screen. The server has the last word on who the reader is.
export function insightStarted(about: { who: Who; bought: boolean }): void {
  if (!current) return;
  current.page = 1;
  remember();
  send({
    sider: 1,
    hvem: about.who,
    kjopt: about.bought,
    vent_start_ms: Date.now() - current.startedAt,
  });
}

// The story never came: out of free stories, a login was needed, or an error.
export function insightStartFailed(message: string): void {
  send({
    stoppet: /gratis historier/i.test(message) ? "kvote" : /logg inn/i.test(message) ? "innlogging" : "feil",
  });
  current = null;
  remember();
}

// A new page was reached. `choices`: what was picked on the pages before it
// (0 or 1; -1 = the grown-up ended the story). `waitMs`: from the tap to the
// page; `hadImage`: the picture of the page that was left had arrived.
export function insightPage(
  page: number,
  choices: number[],
  ending: boolean,
  endedEarly: boolean,
  waitMs: number,
  hadImage: boolean
): void {
  if (!current) return;
  current.page = Math.max(current.page, page);
  current.waits.push(Math.max(0, Math.min(999_999, Math.round(waitMs))));
  if (!hadImage) current.noImage += 1;
  remember();
  send({
    sider: current.page,
    valg: choices.join(","),
    vent_sider: current.waits.join(","),
    bilder_manglet: current.noImage,
    ...(ending ? { ferdig: true, avsluttet_tidlig: endedEarly } : {}),
  });
}

// Something failed in this story: a page, a picture or the read-aloud.
export function insightError(): void {
  if (!current) return;
  current.errors += 1;
  remember();
  send({ feil: current.errors });
}

// The login wall of a guest story: shown, and the Vipps button pressed.
export function insightWall(step: "sett" | "klikket"): void {
  send(step === "sett" ? { vegg_sett: true } : { vegg_sett: true, vegg_klikket: true });
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
        ? {
            id: raw.id,
            startedAt: raw.startedAt,
            page: Number(raw.page) || 1,
            waits: Array.isArray(raw.waits) ? raw.waits.filter((n: unknown) => typeof n === "number") : [],
            errors: Number(raw.errors) || 0,
            noImage: Number(raw.noImage) || 0,
          }
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
