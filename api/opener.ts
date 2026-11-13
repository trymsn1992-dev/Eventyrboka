import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Type } from "@google/genai";
import { ai } from "./_lib/gemini.js";
import { getClientIp, rateLimit } from "./_lib/rate-limit.js";
import { isCustomMetaphor, isPro, takeFreeStory } from "./_lib/access.js";
import { readSession } from "./_lib/session.js";
import { spend } from "./_lib/budget.js";
import { validateOptions } from "./_lib/validate.js";
import { withModelFallback } from "./_lib/retry.js";
import {
  SAFETY_RULES,
  heroAndMoralNotes,
  parseSeed,
  parseSideCharacters,
  storySeeds,
} from "./_lib/story-seeds.js";
import { StoryOptions, DURATION_DENSITY, TOTAL_PAGES } from "../types.js";

// Fast opener endpoint. Writes ONLY page 1 so the reader sees an
// opening scene within ~3–5s. While they read it, the client asks
// /api/side for the next page behind each of the two choices.
//
// Page 1 only introduces the character and the place, and its two choices
// are purely about looks (weather, a colour); the problem arrives on page 2. Besides the page it returns a premise — the problem the story
// will be about — which every later page is written against.
//
// Lite is the primary because:
//  - Page 1 is just a calm introduction of the character plus 2 choices,
//    not the whole arc — lite handles this prose shape well
//  - Lite is markedly faster than full Flash on small structured JSON
// Full Flash + Pro remain as fallbacks if lite is unavailable.
const TEXT_MODEL_CHAIN = [
  "gemini-flash-lite-latest",
  "gemini-3.8-flash",
  "gemini-flash-latest",
  "gemini-2.5-pro",
];

export const maxDuration = 30;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    text: {
      type: Type.STRING,
      description:
        "The opening page text in Norwegian. Concrete and sensory. A calm introduction of the character and the place — no problem yet. Length matches the pacing instructions.",
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
              "VERY SHORT button label in Norwegian (2-5 words, max ~30 chars). A look, not an action: weather, a colour, time of day.",
          },
          nextPlotPoint: {
            type: Type.STRING,
            description:
              "One Norwegian sentence describing how the book looks if this is chosen.",
          },
        },
        required: ["text", "nextPlotPoint"],
      },
      description: "Exactly 2 choices.",
    },
    premise: {
      type: Type.STRING,
      description:
        "1-2 Norwegian sentences: the problem that will appear on page 2 and must be solved by the last page. Not mentioned in the page 1 text. The thread that holds the whole story together.",
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
      description: "Named side characters introduced on this page (0-2). Empty list if none.",
    },
  },
  required: ["text", "illustrationPrompt", "choices", "premise", "sideCharacters"],
};

function buildSystemInstruction(options: StoryOptions, seed: number): string {
  const density = DURATION_DENSITY[options.duration];
  const { openingArchetype, metaphorAngle } = storySeeds(seed, options.metaphor);
  return `Du er en varm, lekende norsk barnebokforfatter.
Du skriver ÅPNINGEN til en interaktiv bok for barn (aldersgruppe ${options.ageGroup}).

Karakter: ${options.character}. Metafor: "${options.metaphor}".
${heroAndMoralNotes(options)}
DETTE ER SIDE 1 AV ${TOTAL_PAGES}. Senere sider skrives ut fra valgene barnet tar.

SIDE 1 ER BARE EN INTRODUKSJON (viktig — barnet vet ingenting ennå):
- La barnet bli kjent med karakteren: hvem de er, hvor vi er, og hva de holder på med akkurat nå.
- Et rolig, trygt og lekent øyeblikk med konkrete, sanselige handlinger som viser stemmen deres.
- Vis gjerne noe karakteren liker, gleder seg til eller er stolt av. Det som blir viktig senere (en ting, et sted, en venn) kan barnet få møte her.
- INGEN PROBLEMER PÅ SIDE 1. Ingenting går galt, ingenting mistes eller ødelegges, ingen uro, ingen vanskelige følelser, ikke noe dilemma.
  Problemet kommer først på side 2.
- Avslutt med at karakteren lurer på det barnet skal få bestemme (se VALG) — for eksempel ved å kikke ut av vinduet eller rote i en kiste.
  Teksten skal IKKE avsløre svaret, og ikke ramse opp de to valgene — knappene gjør det.

TETTHET (varighet: ${options.duration}):
- Omtrent ${density?.sentences ?? "4-6"} setninger.
- Pacing: rolig og varm.

VALG PÅ SIDE 1 — BARE UTSEENDE:
Barnet får bestemme hvordan noe i boka skal SE UT. Valget endrer ikke handlingen, bare hvordan boka ser ut og føles.
- Nøyaktig 2 valg om ÉN og samme ting. Velg det som passer best til karakteren og stedet, for eksempel:
  været (sol / snø / regn / tåke), fargen på noe karakteren har med seg eller tar på seg (skjerf, lue, sekk, ballong, paraply),
  tid på døgnet (morgensol / stjernehimmel), eller fargen på noe i omgivelsene (båten, døra, blomstene).
- De to valgene skal se tydelig forskjellige ut på et bilde.
- IKKE handlinger, IKKE veivalg, IKKE noe som har med et problem å gjøre.
- Ikke la barnet endre det karakteren alltid har (pels, skall, krone og lignende) — bare noe ekstra eller noe i omgivelsene.
- "text" er en KORT knapp-label på norsk: 2-5 ord, maks ~30 tegn. F.eks. "Snø som daler" / "Sol og blå himmel", eller "Rødt skjerf" / "Gult skjerf".
- "nextPlotPoint" er én setning som beskriver hvordan det ser ut når dette er valgt.

PREMISS (skjult plan — skal IKKE stå i teksten på side 1):
'premise' er 1-2 setninger om problemet som dukker opp på side 2, og som må løses innen siste side.
Problemet skal dukke opp ${openingArchetype}, og sette metaforen på prøve${metaphorAngle ? ` (vinkel: ${metaphorAngle})` : ""}.
Det må fungere like godt uansett hvilket av de to utseende-valgene barnet tar.
Det er tråden som holder hele boka sammen.

BIKARAKTERER:
Navngitte bikarakterer på denne siden (0-2) legges i 'sideCharacters' med en grundig visuell bible på ENGELSK.

SPRÅK:
Skriv på norsk BOKMÅL — aldri nynorsk eller dialekt.
Konkrete sanselige detaljer, ikke abstrakte følelser.

'illustrationPrompt' på engelsk, scenens viktigste øyeblikk. Beskriv ikke hovedkarakterens klær.
Bildet på side 1 tegnes FØR barnet har valgt: vis derfor ikke det valget handler om (er valget været, er scenen innendørs; er det en farge, er tingen ikke tatt fram ennå).
${SAFETY_RULES}`;
}

interface OpenerRequestBody {
  options: unknown;
  // Shared with every /api/side call of the same story (see story-seeds.ts).
  seed?: unknown;
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

  // No login needed to start a story: the first pages are free to read
  // (GUEST_PAGES). Guests get the standard story, like the free plan.
  const session = readSession(req);

  const limit = rateLimit(getClientIp(req));
  if (!limit.ok) {
    res.setHeader("Retry-After", String(limit.retryAfter ?? 60));
    return res
      .status(429)
      .json({ error: "Du må vente litt før du fortsetter." });
  }

  // Daily spending cap (see _lib/budget.ts).
  const budget = await spend(req, "story", !session);
  if (!budget.ok) {
    return res.status(429).json({ error: budget.message });
  }

  try {
    const body = (req.body ?? {}) as OpenerRequestBody;
    const options = validateOptions(body.options);
    if (!options) {
      return res.status(400).json({ error: "Ugyldige historievalg." });
    }

    // Free plan and guests: no own moral and the standard drawing style.
    // The free plan also has a weekly quota; a guest's story is counted
    // against it when they log in to read on (see /api/meg).
    const pro = session ? await isPro(session.sub) : false;
    if (!pro) {
      if (isCustomMetaphor(options.metaphor)) {
        return res.status(403).json({ error: "Egen lærepenge er med i Prinsen." });
      }
      delete options.artStyle;
      if (session && !(await takeFreeStory(session.sub))) {
        return res.status(429).json({
          error: "Du har brukt ukas gratis historie. En ny kommer på mandag.",
          grense: "uke",
        });
      }
    }

    const seed = parseSeed(body.seed);
    const systemInstruction = buildSystemInstruction(options, seed);
    const userPrompt =
      "Skriv åpningen nå. Konkret, sanselig scene — ikke oppsummering. Side 1 er bare en rolig introduksjon av karakteren og stedet — problemet kommer først på side 2. Returner JSON etter skjemaet.";

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
          text: "Sol og blå himmel",
          nextPlotPoint: "sola skinner fra en knallblå himmel og alt glitrer i lyset",
        },
        {
          text: "Snø som daler",
          nextPlotPoint: "store, myke snøfnugg daler ned og legger seg som et hvitt teppe over alt",
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
      choices: parsed.choices.map((c: { text?: string; nextPlotPoint?: string }) => ({
        text: c.text ?? "",
        nextPlotPoint: c.nextPlotPoint ?? "",
      })),
      isEnding: false,
      illustrationPrompt: parsed.illustrationPrompt,
      premise: typeof parsed.premise === "string" ? parsed.premise : "",
      sideCharacters: parseSideCharacters(parsed.sideCharacters).slice(0, 2),
      // Started without a login: the client asks for one after GUEST_PAGES.
      gjest: !session,
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
