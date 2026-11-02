import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Type } from "@google/genai";
import { ai } from "./_lib/gemini.js";
import { getClientIp, rateLimit } from "./_lib/rate-limit.js";
import { validateOptions } from "./_lib/validate.js";
import { withRetry } from "./_lib/retry.js";
import { StoryOptions, DURATION_ESTIMATES } from "../types.js";

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
              "Kort merkelapp for beatet på norsk, f.eks. 'Åpning', 'Dilemma', 'Vendepunkt', 'Klimaks', 'Slutt'.",
          },
          summary: {
            type: Type.STRING,
            description:
              "Én setning på norsk som beskriver hva som skjer i dette beatet.",
          },
        },
        required: ["label", "summary"],
      },
      description:
        "3-6 strukturelle beats fordelt over historien, i rekkefølge.",
    },
    moralArc: {
      type: Type.STRING,
      description:
        "Én-to setninger på norsk som beskriver hvordan metaforen testes og løses i løpet av historien.",
    },
    settingSeeds: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description:
        "2-3 konkrete sanselige detaljer om verden/stedet (lukt, lyd, farge, et objekt) som gir konsistens.",
    },
  },
  required: [
    "logline",
    "characterVoice",
    "beats",
    "moralArc",
    "settingSeeds",
  ],
};

function targetBeatCount(duration: string): string {
  const pages = DURATION_ESTIMATES[duration] ?? 8;
  if (pages <= 5) return "3-4";
  if (pages <= 8) return "4-5";
  if (pages <= 15) return "5-6";
  return "6";
}

function buildSystemInstruction(options: StoryOptions): string {
  const beatCount = targetBeatCount(options.duration);
  return `Du er en erfaren norsk barnebokredaktør som planlegger den dramaturgiske buen for en interaktiv historie FØR skrivingen starter.

Historien skal:
- Handle om: ${options.character}
- Ha tema: ${options.theme}
- Være i sjangeren: ${options.genre}
- Formidle metaforen: "${options.metaphor}"
- Være tilpasset aldersgruppen: ${options.ageGroup}
- Ha omtrent ${beatCount} strukturelle beats, siden varigheten er: ${options.duration}.

Lag en plan som:
1. Har en tydelig 3-aktstruktur (åpning → stigning/dilemma → klimaks → oppløsning).
2. Lar metaforen testes konkret (ikke bare nevnes) ved et vendepunkt eller klimaks.
3. Gir karakteren en distinkt stemme — en særegenhet, en liten frykt eller drøm, og en måte å prate på.
4. Setter 2-3 sanselige verden-detaljer (lukt, lyd, farge, et objekt) som senere segmenter kan hente opp igjen for å gi konsistens.
5. Egner seg for aldersgruppen: ingen vold, trusler eller skumle slutter. Alle karakterer er trygge til slutt.

Vær konkret, ikke generisk. "Dilemma" skal ha et faktisk valg knyttet til metaforen, ikke bare "noe vanskelig skjer".`;
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
                text: "Lag planen for historien nå. Returner som JSON etter skjemaet.",
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
