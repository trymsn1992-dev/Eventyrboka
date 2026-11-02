import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Type } from "@google/genai";
import { ai } from "./_lib/gemini.js";
import { getClientIp, rateLimit } from "./_lib/rate-limit.js";
import { validateOptions } from "./_lib/validate.js";
import { withRetry } from "./_lib/retry.js";
import { StoryOptions, StoryPlan, DURATION_ESTIMATES } from "../types.js";

export const maxDuration = 60;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    text: {
      type: Type.STRING,
      description:
        "The story segment text in Norwegian. Keep it engaging and appropriate for the age group.",
    },
    choices: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          text: {
            type: Type.STRING,
            description: "The text displayed on the button for the user to choose.",
          },
          nextPlotPoint: {
            type: Type.STRING,
            description:
              "A short summary of what happens next if this choice is made.",
          },
        },
        required: ["text", "nextPlotPoint"],
      },
      description: "2 to 3 choices for the user to continue the story.",
    },
    isEnding: {
      type: Type.BOOLEAN,
      description: "True if the story has reached a natural conclusion.",
    },
    illustrationPrompt: {
      type: Type.STRING,
      description:
        "A detailed description of a visual scene to illustrate this part of the story (in English). Focus on the characters, setting, and action.",
    },
  },
  required: ["text", "choices", "isEnding"],
};

const SAFETY_RULES = `
VIKTIGE INNHOLDSREGLER (alltid):
- Innholdet er for barn og familier. Ingen vold, ingen trusler, ingen død, ingen skumle monstre som gjør vondt.
- Ingen voksne temaer (romantikk utover vennskap, politikk, religion, rus, kropp, penger utover sunne eksempler).
- Ingen vonde slutter. Alle karakterer skal være trygge til slutt.
- Mild spenning og problemer som løses er fint, men hold tonen varm og trygg.
- Ingen stereotypier eller fordommer om folk, land eller kultur.
- For aldersgruppene 1-2 og 2-3 år: svært enkle setninger, kjente ord, bare milde følelser, mye repetisjon.
- For aldersgruppene 3-4 og 4-5 år: enkle setninger, lett spenning, tydelige løsninger.
- For 6-8 år: litt mer handling og humor, fortsatt uten noe skummelt.
`;

function renderPlanBlock(plan: StoryPlan | undefined): string {
  if (!plan) return "";
  const beats = plan.beats
    .map((b, i) => `  ${i + 1}. ${b.label}: ${b.summary}`)
    .join("\n");
  const settings = plan.settingSeeds.map((s) => `  - ${s}`).join("\n");
  return `
HISTORIEPLAN (hold deg til denne buen — ikke avvik, men gjør hvert beat levende):
Logline: ${plan.logline}

Karakterstemme (bruk konsekvent — samme stemme, særegenhet og måte å prate på hele veien):
${plan.characterVoice}

Beats i rekkefølge:
${beats}

Moralsk bue (hvordan metaforen testes og løses):
${plan.moralArc}

Sanselige verden-detaljer (hent opp igjen minst én i hvert segment når det er naturlig):
${settings}
`;
}

function buildSystemInstruction(
  options: StoryOptions,
  plan: StoryPlan | undefined
): string {
  const planBlock = renderPlanBlock(plan);
  return `Du er en varm, lekende norsk barnebokforfatter.
Du skal skrive en interaktiv historie for barn i alderen ${options.ageGroup}.
Språket skal være enkelt, lekent og engasjerende.

Historien skal handle om: ${options.character}.
Temaet er: ${options.theme}.
Sjangeren er: ${options.genre}.
Den underliggende moralen/metaforen skal være: "${options.metaphor}".

Ønsket varighet for historien er: ${options.duration}.
Tilpass lengden basert på varigheten:
- "Kort (ca. 2,5 min · 5 sider)": ca 3-4 runder med valg før slutten.
- "Middels (ca. 5 min · 8 sider)": ca 6-8 runder med valg.
- "Lang (ca. 10 min · 15 sider)": ca 12-15 runder med valg.
- "Ekstra lang (ca. 15 min · 25 sider)": ca 20+ runder med valg.
${planBlock}
Skriv historien i segmenter. Hvert segment skal være ca. 3-5 setninger.
Bruk sanselige, konkrete detaljer (lyd, lukt, farge, bevegelse) i stedet for abstrakte følelser.
På slutten av hvert segment (unntatt slutten), gi leseren 2 eller 3 valg for å drive handlingen videre.
Valgene skal være meningsfulle — helst to ulike måter å møte dilemmaet på, ikke bare "gå til venstre / gå til høyre".

Inkluder en 'illustrationPrompt' på engelsk som beskriver scenen for en illustratør. Beskriv handlingen og omgivelsene, men du trenger ikke beskrive karakterens utseende i detalj hver gang, da illustratøren kjenner karakteren.

${SAFETY_RULES}`;
}

interface StoryRequestBody {
  options: unknown;
  previousSegments?: Array<{ text: string }>;
  choiceSummary?: string;
  plan?: unknown;
}

function validatePlan(input: unknown): StoryPlan | undefined {
  if (!input || typeof input !== "object") return undefined;
  const p = input as Record<string, unknown>;
  if (
    typeof p.logline !== "string" ||
    typeof p.characterVoice !== "string" ||
    typeof p.moralArc !== "string" ||
    !Array.isArray(p.beats) ||
    !Array.isArray(p.settingSeeds)
  ) {
    return undefined;
  }
  const beats: StoryPlan["beats"] = [];
  for (const b of p.beats.slice(0, 10)) {
    if (!b || typeof b !== "object") continue;
    const beat = b as Record<string, unknown>;
    if (typeof beat.label === "string" && typeof beat.summary === "string") {
      beats.push({
        label: beat.label.slice(0, 60),
        summary: beat.summary.slice(0, 300),
      });
    }
  }
  if (beats.length === 0) return undefined;
  const settingSeeds = p.settingSeeds
    .filter((s): s is string => typeof s === "string")
    .slice(0, 6)
    .map((s) => s.slice(0, 200));
  return {
    logline: p.logline.slice(0, 400),
    characterVoice: p.characterVoice.slice(0, 600),
    beats,
    moralArc: p.moralArc.slice(0, 400),
    settingSeeds,
  };
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
    const body = (req.body ?? {}) as StoryRequestBody;
    const options = validateOptions(body.options);
    if (!options) {
      return res.status(400).json({ error: "Ugyldige historievalg." });
    }

    const previousSegments = Array.isArray(body.previousSegments)
      ? body.previousSegments
          .filter(
            (s): s is { text: string } =>
              !!s && typeof s === "object" && typeof s.text === "string"
          )
          .slice(0, 50)
      : [];

    const choiceSummary =
      typeof body.choiceSummary === "string"
        ? body.choiceSummary.slice(0, 500)
        : undefined;

    const plan = validatePlan(body.plan);

    const systemInstruction = buildSystemInstruction(options, plan);

    const totalPagesEstimate = DURATION_ESTIMATES[options.duration] ?? 8;
    const segmentIndex = previousSegments.length; // 0 for the opener
    const beatHint = plan
      ? (() => {
          const beats = plan.beats;
          // Map segment index to a beat index proportionally.
          const beatIdx = Math.min(
            beats.length - 1,
            Math.floor(
              (segmentIndex / Math.max(1, totalPagesEstimate - 1)) *
                beats.length
            )
          );
          const current = beats[beatIdx];
          const next = beats[beatIdx + 1];
          return `\n\nDu er nå på side ${segmentIndex + 1} av ca. ${totalPagesEstimate}. Hovedbeatet nå er: "${current.label}: ${current.summary}".${
            next ? ` Neste beat blir: "${next.label}: ${next.summary}".` : " Dette er sluttbeatet — rund av varmt og knytt tilbake til åpningen og metaforen."
          }`;
        })()
      : "";

    let userPrompt: string;
    if (previousSegments.length === 0) {
      userPrompt = `Start historien. Åpne med en konkret, sanselig scene — ikke en oppsummering. Introduser karakteren gjennom en handling som viser stemmen deres.${beatHint}`;
    } else {
      const storySoFar = previousSegments
        .map((s, i) => `Del ${i + 1}: ${s.text}`)
        .join("\n\n");
      const endingNudge =
        segmentIndex >= totalPagesEstimate - 1
          ? " Historien nærmer seg slutten — avslutt nå ved å sette isEnding til true og knytt sløyfen tilbake til åpningen og metaforen."
          : "";
      userPrompt = `Historien så langt:\n\n${storySoFar}\n\nBrukeren valgte nå: "${
        choiceSummary ?? "fortsett"
      }". Fortsett historien basert på dette valget.${endingNudge}${beatHint}\n\nHusk 'illustrationPrompt' på engelsk.`;
    }

    const response = await withRetry(() =>
      ai.models.generateContent({
        model: "gemini-3.8-flash",
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
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

    const segment = JSON.parse(response.text);
    return res.status(200).json(segment);
  } catch (error) {
    console.error("Story error:", error);
    const msg = error instanceof Error ? error.message : String(error);
    if (/UNAVAILABLE|high demand|503|timed out|timeout/i.test(msg)) {
      return res.status(503).json({
        error:
          "Historiefortelleren er veldig travel akkurat nå. Vent et minutt og prøv igjen.",
      });
    }
    return res
      .status(500)
      .json({ error: "Kunne ikke generere historien. Prøv igjen." });
  }
}
