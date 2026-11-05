import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Type } from "@google/genai";
import { ai } from "./_lib/gemini.js";
import { getClientIp, rateLimit } from "./_lib/rate-limit.js";
import { validateOptions } from "./_lib/validate.js";
import { withModelFallback } from "./_lib/retry.js";
import { StoryOptions, DURATION_DENSITY, TOTAL_PAGES } from "../types.js";

// Fast opener endpoint. Writes ONLY page 1 so the reader sees an
// opening scene within ~3–5s. The slower, higher-quality /api/book
// call runs in parallel and writes pages 2–5 continuing from here.
//
// Lite is the primary because:
//  - Page 1 is just an opening scene (3–5 sensory sentences + 2 choices),
//    not the whole arc — lite handles this prose shape well
//  - Lite is markedly faster than full Flash on small structured JSON
// Full Flash + Pro remain as fallbacks if lite is unavailable.
const TEXT_MODEL_CHAIN = [
  "gemini-flash-lite-latest",
  "gemini-3.8-flash",
  "gemini-flash-latest",
  "gemini-2.5-pro",
];

const OPENING_ARCHETYPES = [
  "midt i noe uventet som allerede skjer",
  "like etter at noe akkurat har gått galt eller rart",
  "med en mystisk fremmed som dukker opp",
  "på vei vekk fra noe trygt og kjent",
  "like før en viktig hendelse de har gledet seg til",
  "ved at karakteren mister noe de bryr seg om",
  "ved at karakteren finner noe de ikke forventet",
  "med at karakteren føler seg utenfor eller glemt",
  "med en drøm som farger stemningen for det som kommer",
  "midt i en helt vanlig morgen — som bryter sammen på overraskende vis",
];

export const maxDuration = 30;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    text: {
      type: Type.STRING,
      description:
        "The opening page text in Norwegian. Concrete, sensory, action-first. Length matches the pacing instructions.",
    },
    illustrationPrompt: {
      type: Type.STRING,
      description:
        "Visual scene description in English for this opening moment. Do NOT describe main character body/clothes — the illustrator has a reference sheet.",
    },
    choices: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          text: {
            type: Type.STRING,
            description:
              "VERY SHORT button label in Norwegian (2-5 words, max ~30 chars).",
          },
          nextPlotPoint: {
            type: Type.STRING,
            description:
              "Short summary of HOW this choice colors the arrival at the next beat.",
          },
          bridge: {
            type: Type.STRING,
            description:
              "1-2 Norwegian sentences shown on THIS page right after the choice is clicked — the immediate, concrete, sensory consequence.",
          },
        },
        required: ["text", "nextPlotPoint", "bridge"],
      },
      description: "Exactly 2 choices.",
    },
  },
  required: ["text", "illustrationPrompt", "choices"],
};

const SAFETY_RULES = `
VIKTIGE INNHOLDSREGLER:
- For barn og familier. Ingen vold, trusler, død eller skumle monstre.
- Ingen voksne temaer.
- Milde følelser, varm tone.
`;

function pick<T>(arr: T[], seed: number): T {
  return arr[seed % arr.length];
}

function buildSystemInstruction(options: StoryOptions, seed: number): string {
  const density = DURATION_DENSITY[options.duration];
  const openingArchetype = pick(OPENING_ARCHETYPES, seed);
  return `Du er en varm, lekende norsk barnebokforfatter.
Du skriver ÅPNINGEN til en interaktiv bok for barn (aldersgruppe ${options.ageGroup}).

Karakter: ${options.character}. Metafor: "${options.metaphor}".

DETTE ER SIDE 1 AV ${TOTAL_PAGES}. Senere sider skrives av en annen modell som fortsetter herfra — hold deg til åpningen, ikke oppsummer eller konkluder.

Åpne historien ${openingArchetype}.
Introduser karakteren gjennom en konkret, sanselig handling som viser stemmen deres.
Antyd dilemmaet metaforen vil teste, men løs ingenting.

TETTHET (varighet: ${options.duration}):
- Omtrent ${density?.sentences ?? "4-6"} setninger.
- Pacing: ${density?.pacing ?? "balansert"}.

VALG-KVALITET:
- Nøyaktig 2 valg.
- "text" er en KORT knapp-label på norsk: 2-5 ord, maks ~30 tegn. En rask handling.
- "nextPlotPoint" oppsummerer hvordan valget farger neste beat.
- "bridge" er 1-2 setninger på norsk som vises etter klikk — umiddelbar sanselig konsekvens.
- Begge valg skal lede naturlig videre.

SPRÅK:
Konkrete sanselige detaljer, ikke abstrakte følelser.

'illustrationPrompt' på engelsk, scenens viktigste øyeblikk. Beskriv ikke hovedkarakterens klær.
${SAFETY_RULES}`;
}

interface OpenerRequestBody {
  options: unknown;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
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
    return res
      .status(429)
      .json({ error: "Du må vente litt før du fortsetter." });
  }

  try {
    const body = (req.body ?? {}) as OpenerRequestBody;
    const options = validateOptions(body.options);
    if (!options) {
      return res.status(400).json({ error: "Ugyldige historievalg." });
    }

    const seed = Math.floor(Math.random() * 1_000_000);
    const systemInstruction = buildSystemInstruction(options, seed);
    const userPrompt =
      "Skriv åpningen nå. Konkret, sanselig scene — ikke oppsummering. Returner JSON etter skjemaet.";

    const tGemini = Date.now();
    const response = await withModelFallback(TEXT_MODEL_CHAIN, (model) =>
      ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          temperature: 1.05,
          topP: 0.95,
        },
      })
    );
    const geminiMs = Date.now() - tGemini;

    if (!response.text) {
      throw new Error("Tomt svar fra Gemini");
    }

    const parsed = JSON.parse(response.text);
    // Belt-and-suspenders: enforce exactly 2 choices.
    if (!Array.isArray(parsed.choices) || parsed.choices.length < 2) {
      parsed.choices = [
        {
          text: "Fortsett rolig",
          nextPlotPoint: "går videre med rolig stemning",
          bridge:
            "Hen trakk pusten og gikk videre, nysgjerrig på hva som ventet.",
        },
        {
          text: "Fortsett ivrig",
          nextPlotPoint: "går videre med ivrig stemning",
          bridge:
            "Hen smilte bredt og tok et steg videre, ivrig etter å se hva som kom.",
        },
      ];
    } else {
      parsed.choices = parsed.choices.slice(0, 2);
    }

    const totalMs = Date.now() - tStart;
    const prepMs = totalMs - geminiMs;
    console.log(
      `opener.timing total=${totalMs}ms gemini=${geminiMs}ms prep=${prepMs}ms`
    );
    res.setHeader(
      "Server-Timing",
      `prep;dur=${prepMs}, gemini;dur=${geminiMs}, total;dur=${totalMs}`
    );

    return res.status(200).json({
      text: parsed.text,
      choices: parsed.choices,
      isEnding: false,
      illustrationPrompt: parsed.illustrationPrompt,
    });
  } catch (error) {
    console.error("Opener error:", error);
    const msg = error instanceof Error ? error.message : String(error);
    if (/UNAVAILABLE|high demand|503|timed out|timeout/i.test(msg)) {
      return res.status(503).json({
        error:
          "Historiefortelleren er veldig travel akkurat nå. Vent et minutt og prøv igjen.",
      });
    }
    return res
      .status(500)
      .json({ error: "Kunne ikke lage åpningen. Prøv igjen." });
  }
}
