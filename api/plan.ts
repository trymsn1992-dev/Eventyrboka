import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Type } from "@google/genai";
import { ai } from "./_lib/gemini.js";
import { getClientIp, rateLimit } from "./_lib/rate-limit.js";
import { validateOptions } from "./_lib/validate.js";
import { withRetry } from "./_lib/retry.js";
import { StoryOptions, CHOICE_PAGES } from "../types.js";

export const maxDuration = 60;

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
          label: {
            type: Type.STRING,
            description:
              "Kort merkelapp på norsk, f.eks. 'Åpning', 'Første prøve', 'Vendepunkt', 'Klimaks', 'Oppløsning'.",
          },
          summary: {
            type: Type.STRING,
            description:
              "Én-to setninger på norsk som beskriver hva som MÅ skje på dette beatet uansett valg.",
          },
          choicePrompt: {
            type: Type.STRING,
            description:
              "Dilemmaet som driver valget på denne siden, formulert på norsk. UTELAT på det siste beatet (oppløsningen).",
          },
          isMetaphorTest: {
            type: Type.BOOLEAN,
            description:
              "True KUN for beatet som setter metaforen på prøve for alvor (ett beat, typisk nest siste valg-beat).",
          },
        },
        required: ["label", "summary"],
      },
      description: `Nøyaktig ${CHOICE_PAGES + 1} beats i rekkefølge: ${CHOICE_PAGES} valg-beats etterfulgt av ett oppløsnings-beat uten valg.`,
    },
    moralArc: {
      type: Type.STRING,
      description:
        "Én-to setninger på norsk som beskriver hvordan metaforen testes og løses.",
    },
    settingSeeds: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description:
        "2-3 konkrete sanselige detaljer om verden (lukt, lyd, farge, et objekt).",
    },
    sideCharacters: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: {
            type: Type.STRING,
            description: "Navnet på bikarakteren (norsk, f.eks. 'Haren Harald').",
          },
          bible: {
            type: Type.STRING,
            description:
              "Grundig visuell beskrivelse på ENGELSK for illustratøren: art, farger, kropp, ansikt, hvert klesplagg, hvert tilbehør, hva de ALDRI endrer. Minst 4 setninger.",
          },
        },
        required: ["name", "bible"],
      },
      description:
        "0-2 navngitte bikarakterer som kommer tilbake gjennom historien. La listen være tom hvis historien ikke trenger faste bikarakterer.",
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

function buildSystemInstruction(options: StoryOptions): string {
  return `Du er en erfaren norsk barnebokredaktør som planlegger dramaturgien FØR skrivingen starter.

Historien skal:
- Handle om: ${options.character}
- Tema: ${options.theme}
- Sjanger: ${options.genre}
- Formidle metaforen: "${options.metaphor}"
- Være for aldersgruppen: ${options.ageGroup}

STRUKTUR (må følges nøyaktig):
Historien har alltid ${CHOICE_PAGES} valg-beats + 1 oppløsnings-beat (totalt ${CHOICE_PAGES + 1} beats).
Følg klassisk eventyrstruktur:
  Beat 1 — Åpning + inciting moment. Vi møter karakteren i hverdagen, noe forstyrrer den.
           Valg: hvordan reagerer karakteren?
  Beat 2 — Første prøve / stigning. Karakteren tester en tilnærming eller møter en bikarakter.
           Valg: hvordan møter de dette?
  Beat 3 — DET MORALSKE VENDEPUNKTET. Metaforen settes på prøve for alvor.
           Valget MÅ være en konkret, levbar versjon av metaforen (f.eks. for "dele":
           "Del den siste pannekaken med den sultne haren" vs. "Spis den selv").
           Sett isMetaphorTest=true på DETTE beatet.
  Beat 4 — Klimaks. Avgjørende øyeblikk.
           Valg: hvordan vinner karakteren?
  Beat 5 — Oppløsning. Varm avslutning, knytt sløyfen tilbake til åpningen. INGEN choicePrompt.

PERLE-STRUKTUR — veldig viktig:
Hvert beat MÅ skje uansett hvilket valg brukeren tar. Valget påvirker HVORDAN vi kommer dit
(stemning, tilnærming, hvem vi møter), ikke HVOR vi havner. Dette er en kjede av perler, ikke
et forgrenet tre. Beskriv i hvert beats 'summary' det som MÅ skje uansett valg.

VALG-KVALITET:
- Ingen "feil" valg. Begge alternativene er moralsk gyldige og trygge.
- Begge valg uttrykker forskjellige verdier eller tilnærminger (ikke bare "venstre/høyre").
- choicePrompt skal gjøre dilemmaet tydelig — hva står på spill, hva fristes karakteren til.

BIKARAKTERER:
Nevn maksimalt 2 navngitte bikarakterer som gjentar seg. Hver får et grundig visuell "bible"
på ENGELSK som illustratøren bruker hver gang karakteren tegnes. Lås utseende, farger, klær og
tilbehør eksplisitt. La listen være tom hvis historien ikke trenger faste bikarakterer.

ALDERSTILPASSING:
For 1-3 år: svært enkelt dilemma, trygg tone. For 4-5 år: tydelig dilemma, humor. For 6-8 år:
mer handling og konsekvens, fortsatt varm tone.

SIKKERHET:
Ingen vold, trusler, død eller skumle slutter. Alle karakterer er trygge til slutt.
Vær konkret, ikke generisk. "Vendepunkt" skal ha et faktisk, konkret dilemma knyttet til metaforen.`;
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

    const systemInstruction = buildSystemInstruction(options);

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
