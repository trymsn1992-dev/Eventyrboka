import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Type } from "@google/genai";
import { ai } from "./_lib/gemini.js";
import { getClientIp, rateLimit } from "./_lib/rate-limit.js";
import { validateOptions } from "./_lib/validate.js";
import { withModelFallback } from "./_lib/retry.js";
import { StoryOptions, CHOICE_PAGES } from "../types.js";

const TEXT_MODEL_CHAIN = [
  "gemini-3.8-flash",
  "gemini-flash-latest",
  "gemini-flash-lite-latest",
  "gemini-2.5-pro",
];

export const maxDuration = 60;

// Opening archetypes — pass one at random so stories don't all start "det var en gang".
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

// Climax resolution patterns — rotate so the character doesn't "win" the same way every time.
const CLIMAX_PATTERNS = [
  "gjennom en liten, kløktig oppdagelse i siste sekund",
  "ved å stoppe opp og se ting fra en annen vinkel",
  "ved uventet hjelp fra noen de hadde glemt eller oversett",
  "ved å gi slipp på noe de holdt fast i",
  "ved å gjøre noe skummelt én gang til, med noen ved sin side",
  "ved å si noe sant og enkelt høyt",
  "ved å dele noe de ellers ville beholdt for seg selv",
  "gjennom lek og humor som løser opp alvoret",
];

// Dilemma angles for each metaphor — forces the planner off the first obvious interpretation.
const METAPHOR_ANGLES: Record<string, string[]> = {
  "Det lønner seg å dele": [
    "dele med noen de ikke kjenner",
    "dele når de selv ikke har nok",
    "dele æren for noe de gjorde selv",
    "dele en hemmelighet som er trygg å slippe",
    "dele plassen med en som er sjenert",
  ],
  "Fokuser på det du kan påvirke": [
    "la være å bekymre seg for været/noe de ikke rår over",
    "velge sin egen reaksjon når noen er sure",
    "løse en liten bit når det store er for stort",
    "slippe å kontrollere hva andre tenker",
  ],
  "Vær snill mot andre": [
    "være snill mot noen som har vært slem",
    "være snill med handling, ikke bare ord",
    "legge merke til en som ingen andre ser",
    "være snill mot seg selv også",
  ],
  "Det lønner seg å spare": [
    "spare noe godt til senere i stedet for å bruke alt opp",
    "spare på krefter til det virkelig teller",
    "ta vare på noe gammelt i stedet for å kaste det",
    "vente med å si noe til riktig øyeblikk",
  ],
  "Vær modig selv om du er redd": [
    "gjøre noe modig i det stille, uten applaus",
    "si fra når noe ikke er greit",
    "prøve en gang til etter å ha falt",
    "være modig for en annens skyld",
  ],
  "Ærlighet varer lengst": [
    "si sannheten selv om det blir pinlig",
    "innrømme en feil raskt i stedet for å skjule den",
    "være ærlig om hva en føler, ikke bare hva en gjorde",
    "si sannheten vennlig, ikke hardt",
  ],
};

function pick<T>(arr: T[], seed: number): T {
  return arr[seed % arr.length];
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    logline: {
      type: Type.STRING,
      description:
        "One-sentence hook in Norwegian describing the whole arc of the story.",
    },
    characterVoice: {
      type: Type.STRING,
      description:
        "2-3 setninger på norsk som fanger hovedkarakterens stemme: en særegenhet, en frykt eller drøm, og hvordan de prater.",
    },
    beats: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          label: { type: Type.STRING },
          summary: { type: Type.STRING },
          choicePrompt: { type: Type.STRING },
          isMetaphorTest: { type: Type.BOOLEAN },
        },
        required: ["label", "summary"],
      },
      description: `Nøyaktig ${CHOICE_PAGES + 1} beats i rekkefølge: ${CHOICE_PAGES} valg-beats etterfulgt av ett oppløsnings-beat uten valg.`,
    },
    moralArc: { type: Type.STRING },
    settingSeeds: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    sideCharacters: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          bible: { type: Type.STRING },
        },
        required: ["name", "bible"],
      },
    },
  },
  required: [
    "logline",
    "characterVoice",
    "beats",
    "moralArc",
    "settingSeeds",
    "sideCharacters",
  ],
};

function buildSystemInstruction(options: StoryOptions, seed: number): string {
  const openingArchetype = pick(OPENING_ARCHETYPES, seed);
  const climaxPattern = pick(CLIMAX_PATTERNS, seed >> 3);
  const angles = METAPHOR_ANGLES[options.metaphor] ?? [];
  const chosenAngle = angles.length ? pick(angles, seed >> 5) : "";

  return `Du er en norsk barnebokredaktør som planlegger dramaturgien før skrivingen.

Karakter: ${options.character}. Metafor: "${options.metaphor}". Alder: ${options.ageGroup}.

FRØ (bruk — ikke avvik):
- Åpne historien ${openingArchetype}.
- Løs klimakset ${climaxPattern}.${
  chosenAngle
    ? `\n- Metafor-vinkel (ikke den første opplagte): ${chosenAngle}.`
    : ""
}

Du bestemmer setting og sjanger selv. Velg noe spesifikt og uventet — gjerne på tvers av sjangre.

5 beats i rekkefølge (${CHOICE_PAGES} valg + 1 oppløsning):
  1. Åpning + inciting moment (bruk åpnings-arketypen).
  2. Første prøve / stigning.
  3. METAFOR-TEST — bruk metafor-vinkelen. Sett isMetaphorTest=true.
  4. Klimaks (bruk klimaks-mønsteret).
  5. Oppløsning — INGEN choicePrompt, knytt sløyfen til åpningen.

PERLE-STRUKTUR: hvert beat MÅ skje uansett valg. Valget farger HVORDAN, ikke HVOR.
VALG: 2 moralsk gyldige alternativer med ulike tilnærminger. choicePrompt gjør dilemmaet tydelig.
BIKARAKTERER: 0–2 navngitte, med grundig visuell bible på ENGELSK (farger, klær, tilbehør eksplisitt). Hopp over hvis ikke nødvendig.
SIKKERHET: ingen vold, ingen trusler, ingen skumle slutter.`;
}

interface PlanRequestBody {
  options: unknown;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
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
    const body = (req.body ?? {}) as PlanRequestBody;
    const options = validateOptions(body.options);
    if (!options) {
      return res.status(400).json({ error: "Ugyldige historievalg." });
    }

    // Fresh seed per request so each plan picks different archetypes.
    const seed = Math.floor(Math.random() * 1_000_000);
    const systemInstruction = buildSystemInstruction(options, seed);

    const response = await withModelFallback(TEXT_MODEL_CHAIN, (model) =>
      ai.models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `Lag planen nå. Returner JSON etter skjemaet, med nøyaktig ${CHOICE_PAGES + 1} beats.`,
              },
            ],
          },
        ],
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          temperature: 1.1,
          topP: 0.95,
        },
      })
    );

    if (!response.text) {
      throw new Error("Tomt svar fra Gemini");
    }

    const plan = JSON.parse(response.text);
    return res.status(200).json(plan);
  } catch (error) {
    console.error("Plan error:", error);
    const msg = error instanceof Error ? error.message : String(error);
    if (/UNAVAILABLE|high demand|503|timed out|timeout/i.test(msg)) {
      return res.status(503).json({
        error:
          "Historiefortelleren er veldig travel akkurat nå. Vent et minutt og prøv igjen.",
      });
    }
    return res
      .status(500)
      .json({ error: "Kunne ikke planlegge historien. Prøv igjen." });
  }
}
