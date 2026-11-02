import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Type } from "@google/genai";
import { ai } from "./_lib/gemini.js";
import { getClientIp, rateLimit } from "./_lib/rate-limit.js";
import { validateOptions } from "./_lib/validate.js";
import { withRetry } from "./_lib/retry.js";
import {
  StoryOptions,
  StoryPlan,
  DURATION_DENSITY,
  CHOICE_PAGES,
  TOTAL_PAGES,
} from "../types.js";

export const maxDuration = 60;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    text: {
      type: Type.STRING,
      description:
        "The story segment text in Norwegian for this page. Length and density must match the pacing instructions.",
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
              "Short summary of HOW this choice colors the arrival at the next beat (never 'what new destination this choice leads to').",
          },
        },
        required: ["text", "nextPlotPoint"],
      },
      description:
        "Exactly 2 choices for the user. BOTH must lead to the same next beat but with different texture. Omit entirely on the final (ending) page.",
    },
    isEnding: {
      type: Type.BOOLEAN,
      description: "True only on the final resolution page.",
    },
    illustrationPrompt: {
      type: Type.STRING,
      description:
        "Visual scene description in English: the single most important moment of this page. Describe the action, setting and any side characters present. Do NOT describe the main character's clothing or body — the illustrator has a reference sheet.",
    },
  },
  required: ["text", "isEnding"],
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

function renderPlanBlock(plan: StoryPlan): string {
  const beats = plan.beats
    .map((b, i) => {
      const marker = b.isMetaphorTest ? " ⭐ (metafor-test)" : "";
      const choice = b.choicePrompt
        ? `\n       Valg-dilemma: ${b.choicePrompt}`
        : "\n       (ingen valg — oppløsning)";
      return `  ${i + 1}. ${b.label}${marker}: ${b.summary}${choice}`;
    })
    .join("\n");
  const settings = plan.settingSeeds.map((s) => `  - ${s}`).join("\n");
  const sides = plan.sideCharacters?.length
    ? "\nBikarakterer (bruk konsekvent — samme navn og rolle hver gang):\n" +
      plan.sideCharacters.map((s) => `  - ${s.name}`).join("\n")
    : "";
  return `
HISTORIEPLAN (fast skjelett — ikke endre buen):
Logline: ${plan.logline}

Karakterstemme (bruk konsekvent gjennom hele boka):
${plan.characterVoice}

Beats (perle-struktur — ALLE grener fører til samme beat, valget farger bare HVORDAN):
${beats}

Moralsk bue:
${plan.moralArc}

Sanselige verden-detaljer (hent opp igjen minst én hvor det passer):
${settings}
${sides}
`;
}

function buildSystemInstruction(
  options: StoryOptions,
  plan: StoryPlan | undefined
): string {
  const density = DURATION_DENSITY[options.duration];
  const planBlock = plan ? renderPlanBlock(plan) : "";
  return `Du er en varm, lekende norsk barnebokforfatter.
Du skriver en interaktiv bok for barn i aldersgruppen ${options.ageGroup}.
Språket skal være enkelt, lekent og engasjerende.

Historien handler om: ${options.character}.
Metafor: "${options.metaphor}".
Setting og sjanger er bestemt av planen under — hold deg til den.

STRUKTUR:
Boka har NØYAKTIG ${TOTAL_PAGES} sider: ${CHOICE_PAGES} valg-sider etterfulgt av 1 oppløsnings-side uten valg.
Hver side treffer sitt beat fra planen. Du blir fortalt hvilken side du skriver nå.

TETTHET PR SIDE (varighet: ${options.duration}):
- Omtrent ${density?.sentences ?? "4-6"} setninger pr side.
- ${density?.miniScenes ?? 0} mini-scene(r) FØR valget på denne siden.
- Pacing: ${density?.pacing ?? "balansert"}.
En mini-scene er en liten, selvstendig hendelse som åpnes og lukkes før valget: en observasjon,
en kort dialog, et sanselig øyeblikk, et lite møte med en bikarakter. Det er mini-scenene som
gjør en lang bok god, ikke flere sider.

PERLE-STRUKTUR — kritisk:
Begge valgene MÅ lede til samme neste beat. De fargelegger HVORDAN (stemning, tilnærming,
hvem vi møter), de endrer ikke HVOR vi havner. Når du fortsetter etter et valg, må du starte
inne i den samme bue-posisjonen planen oppgir, bare farget av valget brukeren tok.

VALG-KVALITET:
- Nøyaktig 2 valg (unntatt på siste side, som ikke har valg).
- Ingen "feil" valg. Begge er trygge og moralsk gyldige.
- Begge uttrykker ulike tilnærminger eller verdier — ikke bare "venstre/høyre".
- På beatet merket ⭐ (metafor-test) MÅ valgene være en konkret, levbar versjon av metaforen.

SPRÅK:
Bruk konkrete sanselige detaljer (lyd, lukt, farge, bevegelse) i stedet for abstrakte følelser.
"Han var redd" ❌  "Hjertet dunket som en lita tromme" ✓

Inkluder en 'illustrationPrompt' på engelsk som beskriver scenens viktigste øyeblikk. Beskriv
handlingen og omgivelsene, og nevn eventuelle bikarakterer ved navn. Beskriv IKKE hovedkarakterens
klær eller kropp — illustratøren har et referanseark.
${planBlock}
${SAFETY_RULES}`;
}

interface StoryRequestBody {
  options: unknown;
  previousSegments?: Array<{ text: string }>;
  choiceSummary?: string;
  plan?: unknown;
  // Parent escape hatch: when true, treat the next segment as the resolution
  // regardless of how far through the story we are.
  forceEnding?: boolean;
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
  for (const b of p.beats.slice(0, 12)) {
    if (!b || typeof b !== "object") continue;
    const beat = b as Record<string, unknown>;
    if (typeof beat.label === "string" && typeof beat.summary === "string") {
      beats.push({
        label: beat.label.slice(0, 60),
        summary: beat.summary.slice(0, 400),
        choicePrompt:
          typeof beat.choicePrompt === "string"
            ? beat.choicePrompt.slice(0, 400)
            : undefined,
        isMetaphorTest: beat.isMetaphorTest === true,
      });
    }
  }
  if (beats.length === 0) return undefined;
  const settingSeeds = p.settingSeeds
    .filter((s): s is string => typeof s === "string")
    .slice(0, 6)
    .map((s) => s.slice(0, 200));
  const sideCharacters: StoryPlan["sideCharacters"] = [];
  if (Array.isArray(p.sideCharacters)) {
    for (const s of p.sideCharacters.slice(0, 3)) {
      if (!s || typeof s !== "object") continue;
      const row = s as Record<string, unknown>;
      if (typeof row.name === "string" && typeof row.bible === "string") {
        sideCharacters.push({
          name: row.name.slice(0, 80),
          bible: row.bible.slice(0, 1500),
        });
      }
    }
  }
  return {
    logline: p.logline.slice(0, 400),
    characterVoice: p.characterVoice.slice(0, 600),
    beats,
    moralArc: p.moralArc.slice(0, 400),
    settingSeeds,
    sideCharacters,
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

    const segmentIndex = previousSegments.length; // 0 for the opener
    const pageNumber = segmentIndex + 1;
    const forceEnding = body.forceEnding === true;
    const isFinalPage = forceEnding || pageNumber >= TOTAL_PAGES;

    // Direct 1:1 beat mapping. Page N hits beat N (if the plan has one).
    // When forceEnding is set we jump straight to the final beat (the resolution).
    const currentBeat = forceEnding
      ? plan?.beats?.[plan.beats.length - 1]
      : plan?.beats?.[segmentIndex];
    const nextBeat = forceEnding ? undefined : plan?.beats?.[segmentIndex + 1];
    const beatHint = currentBeat
      ? `\n\nDU SKRIVER SIDE ${pageNumber} AV ${TOTAL_PAGES}.
Beatet du MÅ treffe nå: "${currentBeat.label}: ${currentBeat.summary}"${
          currentBeat.isMetaphorTest
            ? "\n⭐ Dette er METAFOR-TESTEN. Valgene MÅ være en konkret, levbar versjon av metaforen."
            : ""
        }${
          currentBeat.choicePrompt
            ? `\nValg-dilemma for denne siden: ${currentBeat.choicePrompt}`
            : ""
        }${
          nextBeat
            ? `\nNeste beat blir: "${nextBeat.label}: ${nextBeat.summary}". Begge valgene MÅ lede naturlig til dette beatet.`
            : ""
        }${
          isFinalPage
            ? "\nDette er oppløsningen. Ingen valg. Rund av varmt, knytt sløyfen tilbake til åpningen og metaforen. Sett isEnding=true og la 'choices' være en tom liste eller utelat den."
            : ""
        }`
      : `\n\nDu skriver side ${pageNumber} av ${TOTAL_PAGES}.${
          isFinalPage
            ? " Dette er oppløsningen — rund av varmt og sett isEnding=true."
            : ""
        }`;

    let userPrompt: string;
    if (previousSegments.length === 0) {
      userPrompt = `Start historien. Åpne med en konkret, sanselig scene — ikke en oppsummering. Introduser karakteren gjennom en handling som viser stemmen deres.${beatHint}`;
    } else if (forceEnding) {
      const storySoFar = previousSegments
        .map((s, i) => `Side ${i + 1}: ${s.text}`)
        .join("\n\n");
      userPrompt = `Historien så langt:\n\n${storySoFar}\n\nEn forelder har bedt om at historien avsluttes nå på neste side. Rund av varmt og raskt: knytt sløyfen tilbake til åpningen, la metaforen "${options.metaphor}" komme tydelig frem, og gi en koselig slutt. Sett isEnding=true og la 'choices' være tom eller utelat den.${beatHint}\n\nHusk 'illustrationPrompt' på engelsk.`;
    } else {
      const storySoFar = previousSegments
        .map((s, i) => `Side ${i + 1}: ${s.text}`)
        .join("\n\n");
      userPrompt = `Historien så langt:\n\n${storySoFar}\n\nBrukeren valgte nå: "${
        choiceSummary ?? "fortsett"
      }". Fortsett slik at dette valget fargelegger scenen (stemning, tilnærming, detaljer), men hold deg til beatet planen krever.${beatHint}\n\nHusk 'illustrationPrompt' på engelsk.`;
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
    // Safety net: force the ending flag + empty choices on the final page.
    if (isFinalPage) {
      segment.isEnding = true;
      segment.choices = [];
    }
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
