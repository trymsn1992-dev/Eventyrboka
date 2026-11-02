import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Type } from "@google/genai";
import { ai } from "./_lib/gemini.js";
import { getClientIp, rateLimit } from "./_lib/rate-limit.js";
import { validateOptions } from "./_lib/validate.js";
import { withRetry } from "./_lib/retry.js";
import { StoryOptions, CHOICE_PAGES } from "../types.js";

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

  return `Du er en erfaren norsk barnebokredaktør som planlegger dramaturgien FØR skrivingen starter.

Historien skal:
- Handle om: ${options.character}
- Formidle metaforen: "${options.metaphor}"
- Være for aldersgruppen: ${options.ageGroup}

VALG AV SETTING OG SJANGER (ditt ansvar):
Du bestemmer selv hvor historien foregår og i hvilken sjanger. Velg noe som kler karakteren
og metaforen godt — ikke det første opplagte. Ikke bruk Fjelltur, Fotballkamp, Bursdag eller
Sirkus med mindre det er genuint den beste rammen for akkurat dette dilemmaet.

VARIASJONS-FRØ (bruk disse — ikke avvik):
- ÅPNINGS-ARKETYPE: Historien skal åpne ${openingArchetype}.
- KLIMAKS-MØNSTER: Karakteren skal løse klimakset ${climaxPattern}.${
  chosenAngle
    ? `\n- METAFOR-VINKEL: Metaforen "${options.metaphor}" skal testes gjennom å ${chosenAngle}. Ikke den første opplagte tolkningen.`
    : ""
}

Unngå klisjeen "det første modellen tenker på". Hvis din første idé er den opplagte, velg
den andre eller tredje. Gjør innstillingen spesifikk og uventet. Lån gjerne detaljer fra
andre sjangre (sci-fi i et bakeri, mysterium på et strandparti, musikal i verdensrommet).

STRUKTUR (må følges nøyaktig):
Historien har alltid ${CHOICE_PAGES} valg-beats + 1 oppløsnings-beat (totalt ${CHOICE_PAGES + 1} beats).
Følg klassisk eventyrstruktur:
  Beat 1 — Åpning + inciting moment, i tråd med åpnings-arketypen over.
           Valg: hvordan reagerer karakteren?
  Beat 2 — Første prøve / stigning.
           Valg: hvordan møter de dette?
  Beat 3 — DET MORALSKE VENDEPUNKTET. Metaforen settes på prøve for alvor, bruk vinkelen over.
           Sett isMetaphorTest=true på DETTE beatet.
  Beat 4 — Klimaks, løst i tråd med klimaks-mønsteret over.
           Valg: hvordan vinner karakteren?
  Beat 5 — Oppløsning. Varm avslutning, knytt sløyfen tilbake til åpningen. INGEN choicePrompt.

PERLE-STRUKTUR — veldig viktig:
Hvert beat MÅ skje uansett hvilket valg brukeren tar. Valget påvirker HVORDAN vi kommer dit
(stemning, tilnærming, hvem vi møter), ikke HVOR vi havner.

VALG-KVALITET:
- Ingen "feil" valg. Begge alternativene er moralsk gyldige og trygge.
- Begge valg uttrykker forskjellige verdier eller tilnærminger.
- choicePrompt skal gjøre dilemmaet tydelig — hva står på spill, hva fristes karakteren til.

BIKARAKTERER:
Maks 2 navngitte bikarakterer. Hver får et grundig visuell "bible" på ENGELSK som illustratøren
bruker hver gang karakteren tegnes. Lås utseende, farger, klær og tilbehør eksplisitt. La listen
være tom hvis historien ikke trenger faste bikarakterer. Velg gjerne uventede bikarakter-typer
(ikke bare "en annen katt" eller "et menneskebarn").

ALDERSTILPASSING:
For 1-3 år: svært enkelt dilemma, trygg tone. For 4-5 år: tydelig dilemma, humor. For 6-8 år:
mer handling og konsekvens, fortsatt varm tone.

SIKKERHET:
Ingen vold, trusler, død eller skumle slutter. Alle karakterer er trygge til slutt.`;
}

interface PlanRequestBody {
  options: unknown;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
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

    const response = await withRetry(() =>
      ai.models.generateContent({
        model: "gemini-3.8-flash",
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
          // Higher temperature on PLANNING only — pushes the model off its
          // first obvious interpretation. Segment writing stays at default.
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
