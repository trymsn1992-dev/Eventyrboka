// Writes the NEXT page of a story, knowing exactly which choice the reader
// made. The client calls this for both choices while the reader is still on
// the current page, so whichever they pick is usually ready on tap.
//
// This replaces the old one-shot /api/book "pearl" flow, where every choice
// led to the same pre-written page: choices had no consequences, and page 2
// had to fit after either choice, so it dropped page 1's thread.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ThinkingLevel, Type } from "@google/genai";
import { ai } from "./_lib/gemini.js";
import { getClientIp, rateLimit } from "./_lib/rate-limit.js";
import { validateOptions } from "./_lib/validate.js";
import { withModelFallback } from "./_lib/retry.js";
import {
  SAFETY_RULES,
  heroAndMoralNotes,
  parseSeed,
  parseSideCharacters,
  storySeeds,
  type SideCharacterInput,
} from "./_lib/story-seeds.js";
import { DURATION_DENSITY, TOTAL_PAGES, type StoryOptions } from "../types.js";

// Full Flash first: lite's prose was noticeably flatter. Pages are written in
// the background while the reader reads, so the extra seconds are hidden.
const TEXT_MODEL_CHAIN = [
  "gemini-3.8-flash",
  "gemini-flash-latest",
  "gemini-2.5-pro",
  "gemini-flash-lite-latest",
];

export const maxDuration = 60;

// Gemini 3 models "think" before answering. LOW cuts a page from ~17 s to
// ~7 s with no visible loss in the prose (MINIMAL returned empty pages).
const thinkingFor = (model: string) =>
  model.startsWith("gemini-3")
    ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
    : {};
const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    text: {
      type: Type.STRING,
      description:
        "The page text in Norwegian. Opens with the concrete consequence of the reader's choice.",
    },
    illustrationPrompt: {
      type: Type.STRING,
      description:
        "Visual scene description in English. Action, setting, side characters by name. Do NOT describe the main character's body/clothes.",
    },
    choices: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          text: {
            type: Type.STRING,
            description: "VERY SHORT button label in Norwegian (2-5 words, max ~30 chars).",
          },
          nextPlotPoint: {
            type: Type.STRING,
            description:
              "One Norwegian sentence: what the character does and what it leads to if this is chosen.",
          },
        },
        required: ["text", "nextPlotPoint"],
      },
      description: "Exactly 2 choices, or an empty list on the last page.",
    },
    newSideCharacters: {
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
      description: "Only NEW named side characters introduced on this page. Empty list if none.",
    },
  },
  required: ["text", "illustrationPrompt", "choices", "newSideCharacters"],
};

interface PathPage {
  text: string;
  choice?: string;
  choiceDirection?: string;
}

function parsePages(raw: unknown): PathPage[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > TOTAL_PAGES - 1) {
    return null;
  }
  const out: PathPage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const r = item as Record<string, unknown>;
    if (typeof r.text !== "string" || !r.text.trim()) return null;
    out.push({
      text: r.text.slice(0, 4000),
      choice: typeof r.choice === "string" ? r.choice.slice(0, 200) : undefined,
      choiceDirection:
        typeof r.choiceDirection === "string" ? r.choiceDirection.slice(0, 400) : undefined,
    });
  }
  return out;
}

function pageRole(
  pageNumber: number,
  ending: boolean,
  forced: boolean,
  options: StoryOptions,
  seeds: ReturnType<typeof storySeeds>
): string {
  if (ending) {
    return `${forced ? "En voksen har bedt om å avslutte historien NÅ, så dette blir siste side selv om historien er kortere enn planlagt.\n" : ""}SIDE ${pageNumber} ER SISTE SIDE — OPPLØSNINGEN.
- Løs problemet fra premisset ${seeds.climaxPattern}.
- Slutten MÅ speile valgene leseren faktisk tok, særlig valget på metafor-siden (side 3) hvis historien kom så langt.
  Valgte barnet det fristende alternativet, vis en mild, naturlig følge og et varmt lite lærings-øyeblikk — aldri skam, straff eller moralpreken.
  Valgte barnet i tråd med "${options.metaphor}", la det lønne seg på en konkret, gledelig måte.
- Knytt sløyfen tilbake til side 1.
- Ingen valg: "choices" er en tom liste.`;
  }
  switch (pageNumber) {
    case 2:
      return `SIDE 2 — PROBLEMET DUKKER OPP:
Side 1 var bare en rolig introduksjon, og valget der handlet bare om utseende.
Nå dukker problemet fra premisset opp for første gang, ${seeds.openingArchetype}. Vis det skje i scenen, tydelig og konkret.
Valgene på slutten av siden er to ulike måter å møte problemet på, og skal peke mot dilemmaet som kommer.`;
    case 3:
      return `SIDE 3 — METAFOR-TESTEN:
Her settes "${options.metaphor}" på prøve${seeds.metaphorAngle ? ` (vinkel: ${seeds.metaphorAngle})` : ""}.
De to valgene er to konkrete, levbare handlinger i dilemmaet: det ene i tråd med metaforen, det andre det fristende motsatte.
Begge skal være forståelige for et barn, og ingen av dem er "feil" eller skammelige.`;
    case 4:
      return `SIDE 4 — VENDEPUNKT:
Følgene av valget på side 3 blir synlige — naturlige og milde. Problemet når sitt mest spennende punkt.
Valgene leder mot løsningen, som skal skje ${seeds.climaxPattern}.`;
    default:
      return `SIDE ${pageNumber}: før historien videre mot løsningen.`;
  }
}

function buildSystemInstruction(
  options: StoryOptions,
  seed: number,
  premise: string,
  pages: PathPage[],
  sideCharacters: SideCharacterInput[],
  ending: boolean,
  forced: boolean
): string {
  const pageNumber = pages.length + 1;
  const density = DURATION_DENSITY[options.duration];
  const seeds = storySeeds(seed, options.metaphor);
  const last = pages[pages.length - 1];

  const storySoFar = pages
    .map((p, i) => {
      const chosen = p.choice
        ? `\nLeseren valgte: «${p.choice}»${p.choiceDirection ? ` — ${p.choiceDirection}` : ""}`
        : "";
      return `<SIDE ${i + 1}>\n${p.text}\n</SIDE ${i + 1}>${chosen}`;
    })
    .join("\n\n");

  const known = sideCharacters.length
    ? `\nBIKARAKTERER SOM ALLEREDE FINNES (bruk nøyaktig samme navn):\n${sideCharacters
        .map((s) => `- ${s.name}`)
        .join("\n")}\n`
    : "";

  // The choice on page 1 is only about looks (weather, a colour). It holds
  // for the whole book, in the text and in every illustration.
  const lookChoice = pages[0].choice;
  const look = lookChoice
    ? `\nUTSEENDE-VALGET (gjelder HELE boka):
På side 1 bestemte barnet hvordan noe skal se ut: «${lookChoice}»${pages[0].choiceDirection ? ` — ${pages[0].choiceDirection}` : ""}.
Det var bare et utseende-valg og endrer ikke handlingen, men det skal synes på hver side: nevn det kort og naturlig i teksten,
og avslutt ALLTID 'illustrationPrompt' med en egen setning som starter med "Reader's choice:" og beskriver det på engelsk.\n`
    : "";

  const opening = !last.choice
    ? `Fortsett rett fra slutten av side ${pages.length}.`
    : pageNumber === 2
      ? `SIDE 2 MÅ ÅPNE MED AT BARNET SER VALGET SITT «${last.choice}».
Vis det i første eller andre setning, konkret og sanselig (hvordan det ser ut, kjennes og høres ut).
Ikke oppsummer med ord som "Kim valgte …" — vis det.`
      : `SIDE ${pageNumber} MÅ ÅPNE MED DEN DIREKTE KONSEKVENSEN AV VALGET «${last.choice}».
Barnet skal kjenne igjen valget sitt i første eller andre setning: vis karakteren gjøre det, og hva som skjer rett etterpå.
Ikke oppsummer valget med ord som "Kim valgte å …" — vis det skje.`;

  return `Du er en varm, lekende norsk barnebokforfatter.
Du skriver side ${pageNumber} av ${TOTAL_PAGES} i en interaktiv bok der barnets valg virkelig betyr noe.

Hovedkarakter: ${options.character}. Metafor: "${options.metaphor}". Aldersgruppe: ${options.ageGroup}.
${heroAndMoralNotes(options)}${premise ? `\nPREMISS (tråden som holder historien sammen, og som løses på siste side):\n${premise}\n` : ""}
HISTORIEN SÅ LANGT:

${storySoFar}
${known}
${look}
${opening}

${pageRole(pageNumber, ending, forced, options, seeds)}

SAMMENHENG (kritisk):
- Følg opp trådene. Ting, figurer, steder og problemer fra tidligere sider skal ikke forsvinne eller byttes ut med noe helt nytt.
- Ikke motsi noe som allerede har skjedd. Det leseren valgte, HAR skjedd.
- Samme stemme, samme verden, samme tid på døgnet med mindre historien flytter den.

TETTHET (varighet: ${options.duration}):
- Omtrent ${density?.sentences ?? "4-6"} setninger.
- ${density?.miniScenes ?? 0} mini-scene(r) før valget.
- Pacing: ${density?.pacing ?? "balansert"}.
${
  ending
    ? ""
    : `
VALG (nøyaktig 2):
- "text" er en KORT knapp-label på norsk: 2-5 ord, maks ~30 tegn. En rask handling, ikke en setning.
- De to valgene må være ulike handlinger som fører til ulike ting — ikke to varianter av det samme.
- Begge skal handle om problemet på denne siden.
- "nextPlotPoint" er én setning om hva karakteren gjør og hva det fører til.
`
}
SPRÅK:
Skriv på norsk BOKMÅL — aldri nynorsk eller dialekt.
Konkrete sanselige detaljer (lyd, lukt, farge, bevegelse) i stedet for abstrakte følelser.
"Han var redd" ❌  "Hjertet dunket som en lita tromme" ✓

ILLUSTRASJON:
'illustrationPrompt' på engelsk: sidens viktigste øyeblikk, handling og omgivelser, bikarakterer ved navn.
Beskriv IKKE hovedkarakterens kropp eller klær — illustratøren har et referanseark.

NYE BIKARAKTERER:
Introduserer du en ny navngitt bikarakter på denne siden, legg den i 'newSideCharacters' med en grundig visuell bible på ENGELSK.
Bikarakterer som allerede finnes, skal IKKE med der. Maks 2 navngitte bikarakterer i hele boka.
${SAFETY_RULES}`;
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

  const limit = rateLimit(getClientIp(req));
  if (!limit.ok) {
    res.setHeader("Retry-After", String(limit.retryAfter ?? 60));
    return res.status(429).json({ error: "Du må vente litt før du fortsetter." });
  }

  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const options = validateOptions(body.options);
    const pages = parsePages(body.pages);
    if (!options || !pages) {
      return res.status(400).json({ error: "Ugyldig forespørsel." });
    }
    const seed = parseSeed(body.seed);
    const premise = typeof body.premise === "string" ? body.premise.slice(0, 600) : "";
    const sideCharacters = parseSideCharacters(body.sideCharacters);
    const forced = body.forceEnding === true;
    const pageNumber = pages.length + 1;
    const ending = forced || pageNumber >= TOTAL_PAGES;

    const systemInstruction = buildSystemInstruction(
      options,
      seed,
      premise,
      pages,
      sideCharacters,
      ending,
      forced
    );

    const tGemini = Date.now();
    const response = await withModelFallback(
      TEXT_MODEL_CHAIN,
      (model) =>
        ai.models.generateContent({
          model,
          contents: [
            {
              role: "user",
              parts: [{ text: `Skriv side ${pageNumber} nå. Returner JSON etter skjemaet.` }],
            },
          ],
          config: {
            systemInstruction,
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA,
            temperature: 0.95,
            topP: 0.95,
            ...thinkingFor(model),
          },
        }),
      { timeoutMs: 30_000 }
    );
    const geminiMs = Date.now() - tGemini;
    if (!response.text) throw new Error("Tomt svar fra Gemini");

    const parsed = JSON.parse(response.text) as {
      text?: string;
      illustrationPrompt?: string;
      choices?: Array<{ text?: string; nextPlotPoint?: string }>;
      newSideCharacters?: unknown;
    };
    if (!parsed.text || !parsed.text.trim()) throw new Error("Tomt svar fra Gemini");

    let choices: Array<{ text: string; nextPlotPoint: string }> = [];
    if (!ending) {
      choices = (parsed.choices ?? [])
        .filter((c) => typeof c?.text === "string" && c.text.trim())
        .slice(0, 2)
        .map((c) => ({ text: c.text!.trim(), nextPlotPoint: (c.nextPlotPoint ?? "").trim() }));
      if (choices.length < 2) throw new Error("Tomt svar fra Gemini: mangler valg");
    }

    const known = new Set(sideCharacters.map((s) => s.name.toLowerCase()));
    const newSideCharacters = parseSideCharacters(parsed.newSideCharacters)
      .filter((s) => !known.has(s.name.toLowerCase()))
      .slice(0, Math.max(0, 2 - sideCharacters.length));

    const totalMs = Date.now() - tStart;
    console.log(
      `side.timing page=${pageNumber} ending=${ending ? 1 : 0} total=${totalMs}ms gemini=${geminiMs}ms`
    );
    res.setHeader("Server-Timing", `gemini;dur=${geminiMs}, total;dur=${totalMs}`);

    return res.status(200).json({
      text: parsed.text.trim(),
      illustrationPrompt: parsed.illustrationPrompt ?? "",
      choices,
      isEnding: ending,
      newSideCharacters,
    });
  } catch (error) {
    console.error("Side error:", error);
    const msg = error instanceof Error ? error.message : String(error);
    if (/UNAVAILABLE|high demand|503|timed out|timeout/i.test(msg)) {
      return res.status(503).json({
        error: "Historiefortelleren er veldig travel akkurat nå. Vent et minutt og prøv igjen.",
      });
    }
    return res.status(500).json({ error: "Kunne ikke lage neste side. Prøv igjen." });
  }
}
