// Writes a whole book in one go: five pages without choices, made to be
// printed («Lag til print»). Only for someone who is logged in; costs one wish.
//
//   POST { options, seed, omskriving? }
//     -> { tittel, oppsummering, sider: [{ text, illustrationPrompt }],
//          sideCharacters, onsker, kjopt, omskriving?, omskrivingerIgjen }
//
// Only the text is written here. The grown-up reads the summary first; the
// pictures (the costly part) are drawn afterwards, by /api/character-sheet
// and /api/image, once they have said yes. If the story didn't suit, they
// may have it written again once for free: the answer carries a signed pass
// for that (`omskriving`).
//
// One call writes the whole arc, so the pages agree with each other in a way
// the page-by-page flow (/api/opener + /api/side) has to work for.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Type } from "@google/genai";
import { ai } from "./_lib/gemini.js";
import { getClientIp, rateLimit } from "./_lib/rate-limit.js";
import {
  isCustomMetaphor,
  outOfWishes,
  refundWishes,
  requireLogin,
  spendWishes,
  type WishReceipts,
} from "./_lib/access.js";
import { hasItem, moralItemId } from "./_lib/samling.js";
import { openCookie, sealCookie } from "./_lib/session.js";
import { getAccount } from "./_lib/supabase.js";
import { spend } from "./_lib/budget.js";
import { validateOptions } from "./_lib/validate.js";
import { heroLabel } from "./_lib/hero.js";
import {
  SAFETY_RULES,
  heroAndMoralNotes,
  parseSeed,
  parseSideCharacters,
  storySeeds,
} from "./_lib/story-seeds.js";
import { DURATION_DENSITY, TOTAL_PAGES, type StoryOptions } from "../types.js";

export const maxDuration = 120;

// Full Flash first, thinking as much as it likes: the story is read by a
// grown-up before anything is drawn, so a good story matters more than a few
// seconds. Each model gets ONE attempt with a hard limit, so the function
// always has time left to give the wish back (see `refund`).
const ATTEMPTS: Array<{ model: string; timeoutMs: number }> = [
  { model: "gemini-3.8-flash", timeoutMs: 55_000 },
  { model: "gemini-flash-latest", timeoutMs: 40_000 },
];

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: {
      type: Type.STRING,
      description: "The title of the book in Norwegian, 2-6 words. No quotation marks.",
    },
    summary: {
      type: Type.STRING,
      description:
        "For the grown-up, in Norwegian: 3-4 plain sentences telling what happens from start to end and how the moral shows. Give the ending away.",
    },
    pages: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          text: { type: Type.STRING, description: "The page text in Norwegian." },
          illustrationPrompt: {
            type: Type.STRING,
            description:
              "Visual scene description in English for the most important moment on this page. The main character is ALWAYS in the picture, named. Do NOT describe their body/clothes.",
          },
        },
        required: ["text", "illustrationPrompt"],
      },
      description: `Exactly ${TOTAL_PAGES} pages, in order.`,
    },
    sideCharacters: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          bible: {
            type: Type.STRING,
            description: "Thorough visual description in English: species, colors, clothes, accessories.",
          },
        },
        required: ["name", "bible"],
      },
      description: "Every named side character in the book (0-2). Empty list if none.",
    },
  },
  required: ["title", "summary", "pages", "sideCharacters"],
};

function buildSystemInstruction(options: StoryOptions, seed: number): string {
  const density = DURATION_DENSITY[options.duration];
  const { openingArchetype, climaxPattern, metaphorAngle } = storySeeds(seed, options.metaphor);
  return `Du er en varm, lekende norsk barnebokforfatter.
Du skriver EN HEL bildebok på ${TOTAL_PAGES} sider for barn (aldersgruppe ${options.ageGroup}). Boka skal skrives ut og leses høyt av en voksen.
Det er ingen valg i boka: du bestemmer hele veien, og skal lage én sammenhengende, godt fortalt historie.

Hovedkarakter: ${heroLabel(options)}. Metafor: "${options.metaphor}".
${heroAndMoralNotes(options)}
PLANLEGG FØRST (ikke skriv planen ut):
Finn ett konkret problem som setter metaforen på prøve${metaphorAngle ? ` (vinkel: ${metaphorAngle})` : ""}, og én ting, ett sted eller én venn som er med fra første til siste side.
Skriv så sidene slik at hver side følger av den forrige.

DE ${TOTAL_PAGES} SIDENE:
- SIDE 1 — BLI KJENT: Et rolig, trygt og lekent øyeblikk. Hvem karakteren er, hvor vi er, og hva hen holder på med. Vis noe hen liker eller gleder seg til — gjerne det som blir viktig senere. INGEN problemer, ingen uro.
- SIDE 2 — PROBLEMET DUKKER OPP: ${openingArchetype}. Vis det skje i scenen, tydelig og konkret.
- SIDE 3 — METAFOREN SETTES PÅ PRØVE: Karakteren står i et dilemma der det er fristende å gjøre det motsatte av "${options.metaphor}". Vis fristelsen og nølingen. Hen kan gjerne prøve den lette veien et lite øyeblikk og kjenne at det skurrer — aldri skam, straff eller moralpreken.
- SIDE 4 — VENDEPUNKT: Det mest spennende punktet. Karakteren velger i tråd med metaforen, med handling og ikke bare ord, og vi ser hva det setter i gang.
- SIDE 5 — OPPLØSNING: Problemet løses ${climaxPattern}. Det lønner seg på en konkret, gledelig måte. Knytt sløyfen tilbake til side 1, og slutt varmt og rolig — en god siste setning å lukke boka på.

GOD FORTELLING (viktig):
- Vis, ikke forklar. Metaforen skal aldri sies rett ut som en regel; barnet skal kjenne den gjennom det som skjer. Ordene i metaforen kan gjerne stå én gang, sagt av en karakter, på siste side.
- Én tråd. Ting, figurer og steder fra tidligere sider forsvinner ikke og byttes ikke ut.
- Dialog og små, morsomme detaljer gjør karakterene levende. Bruk gjentakelser barn kan vente på.
- Hver side slutter slik at man får lyst til å bla om (unntatt den siste).
- Samme stemme, samme verden, samme tid på døgnet med mindre historien flytter den.

TETTHET (varighet: ${options.duration}):
- Omtrent ${density?.sentences ?? "4-6"} setninger på hver side.
- Pacing: ${density?.pacing ?? "balansert"}.

SPRÅK:
Skriv på norsk BOKMÅL — aldri nynorsk eller dialekt.
Konkrete sanselige detaljer (lyd, lukt, farge, bevegelse) i stedet for abstrakte følelser.
"Han var redd" ❌  "Hjertet dunket som en lita tromme" ✓

ILLUSTRASJONER:
'illustrationPrompt' på engelsk for hver side: sidens viktigste øyeblikk, handling og omgivelser, bikarakterer ved navn.
Hovedkarakteren skal ALLTID være med på bildet: nevn "${options.character}" ved navn og si hva hen gjør. Beskriv aldri bare et tomt rom eller landskap.
Beskriv IKKE hovedkarakterens kropp eller klær — illustratøren har et referanseark.
De fem bildene skal være tydelig forskjellige scener.

BIKARAKTERER:
Høyst 2 navngitte bikarakterer i hele boka. Alle legges i 'sideCharacters' med en grundig visuell bible på ENGELSK.

TITTEL OG OPPSUMMERING:
'title' er bokas tittel på norsk, 2-6 ord.
'summary' er til den voksne som skal lese boka: 3-4 nøkterne setninger om hva som skjer fra start til slutt og hvordan lærepengen kommer fram. Røp gjerne slutten.
${SAFETY_RULES}`;
}

// The pass for one free rewrite of a book that is already paid for.
const FREE_REWRITES = 1;
const REWRITE_LIFETIME_SEC = 60 * 60;

const rewritePass = (vippsSub: string, left: number): string | undefined =>
  left > 0 ? sealCookie("omskriving", { sub: vippsSub, igjen: left }, REWRITE_LIFETIME_SEC) : undefined;

function rewritesLeft(vippsSub: string, pass: unknown): number {
  if (typeof pass !== "string" || pass.length > 600) return 0;
  try {
    const p = openCookie<{ sub: string; igjen: number }>("omskriving", pass);
    return p && p.sub === vippsSub && Number.isInteger(p.igjen) && p.igjen > 0 ? p.igjen : 0;
  } catch {
    return 0;
  }
}

const withTimeout = <T,>(work: Promise<T>, ms: number): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });

interface Book {
  title: string;
  summary: string;
  pages: Array<{ text: string; illustrationPrompt: string }>;
  sideCharacters: Array<{ name: string; bible: string }>;
}

const line = (raw: unknown, max: number): string =>
  typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, max) : "";

// The model's answer as a book, or null when it isn't one.
function parseBook(text: string | undefined): Book | null {
  if (!text) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!Array.isArray(raw.pages) || raw.pages.length < TOTAL_PAGES) return null;
  const pages = raw.pages.slice(0, TOTAL_PAGES).map((p) => {
    const row = (p ?? {}) as Record<string, unknown>;
    return {
      text: typeof row.text === "string" ? row.text.trim().slice(0, 4000) : "",
      illustrationPrompt: line(row.illustrationPrompt, 1000),
    };
  });
  if (pages.some((p) => !p.text)) return null;
  return {
    title: line(raw.title, 80),
    summary: typeof raw.summary === "string" ? raw.summary.trim().slice(0, 1200) : "",
    pages,
    sideCharacters: parseSideCharacters(raw.sideCharacters).slice(0, 2),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const tStart = Date.now();
  if (req.method === "OPTIONS") {
    res.setHeader("Allow", "POST");
    return res.status(204).end();
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = requireLogin(req, res);
  if (!session) return;

  const limit = rateLimit(getClientIp(req));
  if (!limit.ok) {
    res.setHeader("Retry-After", String(limit.retryAfter ?? 60));
    return res.status(429).json({ error: "Du må vente litt før du fortsetter." });
  }

  const body = (req.body ?? {}) as { options?: unknown; seed?: unknown; omskriving?: unknown };
  const options = validateOptions(body.options);
  if (!options) {
    return res.status(400).json({ error: "Ugyldige historievalg." });
  }
  // A moral of your own is made — and paid for — before the story
  // (/api/samling), so here it has to be one the account keeps.
  if (
    isCustomMetaphor(options.metaphor) &&
    !(await hasItem(session.sub, moralItemId(session.sub, options.metaphor)))
  ) {
    return res.status(403).json({ error: "Lag lærepengen først, så kan den brukes i boka." });
  }

  // Daily spending cap (see _lib/budget.ts).
  const budget = await spend(req, "story", session);
  if (!budget.ok) {
    return res.status(429).json({ error: budget.message });
  }

  // One wish — unless this is the free rewrite of a book already paid for.
  // Given back if no book comes out of it.
  const rewrites = rewritesLeft(session.sub, body.omskriving);
  let receipts: WishReceipts | null = null;
  if (rewrites === 0) {
    const { plan } = await getAccount(session.sub);
    receipts = await spendWishes(session.sub, 1, plan);
    if (!receipts) return res.status(429).json(outOfWishes(1));
  }

  const seed = parseSeed(body.seed);
  const systemInstruction = buildSystemInstruction(options, seed);
  let book: Book | null = null;
  let lastError: unknown = null;
  for (const attempt of ATTEMPTS) {
    try {
      const response = await withTimeout(
        ai.models.generateContent({
          model: attempt.model,
          contents: [
            { role: "user", parts: [{ text: "Skriv hele boka nå. Returner JSON etter skjemaet." }] },
          ],
          config: {
            systemInstruction,
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA,
            temperature: 1.0,
            topP: 0.95,
          },
        }),
        attempt.timeoutMs
      );
      book = parseBook(response.text);
      if (book) break;
      lastError = new Error("Tomt eller ufullstendig svar fra Gemini");
    } catch (error) {
      lastError = error;
    }
    console.warn(
      `bok: ${attempt.model} ga ingen bok:`,
      lastError instanceof Error ? lastError.message : String(lastError)
    );
  }

  if (!book) {
    console.error("Bok error:", lastError);
    await refundWishes(session.sub, receipts);
    return res.status(503).json({
      error: "Historiefortelleren fikk det ikke til denne gangen. Du har fått ønsket tilbake – prøv igjen om litt.",
    });
  }

  console.log(`bok.timing total=${Date.now() - tStart}ms`);
  const left = rewrites > 0 ? rewrites - 1 : FREE_REWRITES;
  return res.status(200).json({
    tittel: book.title,
    oppsummering: book.summary,
    sider: book.pages,
    sideCharacters: book.sideCharacters,
    // What it cost, and whether it was a bought wish.
    onsker: receipts ? 1 : 0,
    kjopt: Boolean(receipts?.some((r) => r !== "uke")),
    // For "Lag en ny historie": a rewrite that costs nothing, and how many.
    omskriving: rewritePass(session.sub, left),
    omskrivingerIgjen: left,
  });
}
