import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Type } from "@google/genai";
import { ai } from "./_lib/gemini.js";
import { getClientIp, rateLimit } from "./_lib/rate-limit.js";
import { spend } from "./_lib/budget.js";
import { validateOptions } from "./_lib/validate.js";
import { withModelFallback } from "./_lib/retry.js";

// Chain draws from separate capacity pools so an overload on one does not
// knock out the whole service:
//   - gemini-3.8-flash: newest Flash, best fit but hits capacity caps
//   - gemini-flash-latest: alias, often the same pool as 3.8 but not always
//   - gemini-flash-lite-latest: smaller Flash, different pool, lower quality
//   - gemini-2.5-pro: older but almost always available; slower, pricier
// isTransient() + 404 handling means we skip any that are retired without
// bubbling 500 to the user.
const TEXT_MODEL_CHAIN = [
  "gemini-3.8-flash",
  "gemini-flash-latest",
  "gemini-flash-lite-latest",
  "gemini-2.5-pro",
];
import {
  StoryOptions,
  StoryPlan,
  DURATION_DENSITY,
  CHOICE_PAGES,
  TOTAL_PAGES,
} from "../types.js";

// Same pool as the planner — used for segment 1 when the plan has not landed yet,
// so the opener still gets a varied, non-generic start.
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
            description:
              "VERY SHORT button label in Norwegian: 2-5 words, maximum ~30 characters. A quick action phrase like 'Innrømmer det ærlig' or 'Henter limtuben'. NEVER a full sentence or plot summary — the summary goes in nextPlotPoint.",
          },
          nextPlotPoint: {
            type: Type.STRING,
            description:
              "Short summary of HOW this choice colors the arrival at the next beat (never 'what new destination this choice leads to').",
          },
          bridge: {
            type: Type.STRING,
            description:
              "1-2 setninger på NORSK som vises på SAMME side rett etter at brukeren har valgt dette alternativet. Beskriv den umiddelbare konsekvensen av valget — hva karakteren gjør eller føler akkurat nå — slik at barnet har noe å lese mens neste side lages. Må være konkret og sanselig, ikke oppsummering. Må lede naturlig videre inn mot neste beat.",
          },
        },
        required: ["text", "nextPlotPoint", "bridge"],
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

VALG-TEKST (viktig — knappene skal være lette å lese for barn):
- "text"-feltet skal være KORT: 2-5 ord, maks ~30 tegn. En rask handling: "Innrømmer det ærlig", "Henter limtuben", "Deler kaken".
- IKKE en hel setning. IKKE en oppsummering. Den detaljerte oppsummeringen av hva som skjer legges KUN i nextPlotPoint.
- Dårlig: "Nils peker ærlig med poten opp mot fiskekakene for å innrømme fristelsen."
- Bra:   "Innrømmer det ærlig"

BRIDGE-TEKST (viktig — dette er det barnet leser mens neste side genereres):
- "bridge"-feltet er 1-2 setninger på norsk som vises på DENNE siden rett etter at valget er klikket.
- Beskriv den umiddelbare konsekvensen av valget: hva karakteren gjør, føler eller ser akkurat nå.
- Konkret og sanselig, ikke abstrakt oppsummering. Driver handlingen fremover.
- Må lede naturlig mot neste beat — ikke lukke av scenen, men åpne mot det som kommer.
- Eksempel: valg "Innrømmer det ærlig" → bridge: "Nils senket halen og mjauet lavt. 'Jeg smakte bare litt...' Bestemor Astrid satte seg ned og klappet puten ved siden av seg."

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
  const tStart = Date.now();
  // OPTIONS is only used by the SetupScreen's warming pings — ack it quietly so
  // the browser does not log it as a red error alongside real failures.
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

  // Daily spending cap (see _lib/budget.ts).
  const budget = await spend(req, "text");
  if (!budget.ok) {
    return res.status(429).json({ error: budget.message });
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
      // Fast path: segment 1 does not wait for the plan. Pick an opening
      // archetype directly so the opener still varies, and let the planner
      // run in the background for segments 2+.
      const openingArchetype =
        OPENING_ARCHETYPES[Math.floor(Math.random() * OPENING_ARCHETYPES.length)];
      const openerExtras = plan
        ? ""
        : `\n\nDette er side 1 av ${TOTAL_PAGES}. Åpne historien ${openingArchetype}. Introduser ${options.character} gjennom en konkret handling som viser stemmen deres, antyd dilemmaet metaforen "${options.metaphor}" vil teste. Begge valg skal lede naturlig videre i historien.`;
      userPrompt = `Start historien. Åpne med en konkret, sanselig scene — ikke en oppsummering. Introduser karakteren gjennom en handling som viser stemmen deres.${beatHint}${openerExtras}`;
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

    const tGemini = Date.now();
    const response = await withModelFallback(TEXT_MODEL_CHAIN, (model) =>
      ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      })
    );
    const geminiMs = Date.now() - tGemini;

    if (!response.text) {
      // Log the full response shape once so we can see what the model
      // actually returned when the convenience .text getter is empty.
      try {
        console.warn(
          "story.empty-response",
          JSON.stringify({
            candidates: response.candidates?.map((c) => ({
              finishReason: c.finishReason,
              safetyRatings: c.safetyRatings,
              partsKinds: c.content?.parts?.map((p) =>
                Object.keys(p).filter((k) => k !== "text")
              ),
            })),
            promptFeedback: (response as unknown as { promptFeedback?: unknown }).promptFeedback,
          }).slice(0, 2000)
        );
      } catch {
        // ignore
      }
      throw new Error("Tomt svar fra Gemini");
    }

    const segment = JSON.parse(response.text);
    if (isFinalPage) {
      segment.isEnding = true;
      segment.choices = [];
    }
    const totalMs = Date.now() - tStart;
    const prepMs = totalMs - geminiMs;
    const page = pageNumber;
    const hasPlan = plan ? 1 : 0;
    // Logged in Vercel runtime logs so we can see where seconds go.
    console.log(
      `story.timing page=${page} hasPlan=${hasPlan} total=${totalMs}ms gemini=${geminiMs}ms prep=${prepMs}ms`
    );
    // Browser DevTools surfaces this in the Network tab's "Timing" column.
    res.setHeader(
      "Server-Timing",
      `prep;dur=${prepMs}, gemini;dur=${geminiMs}, total;dur=${totalMs}`
    );
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
