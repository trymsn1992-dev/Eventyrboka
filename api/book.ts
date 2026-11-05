import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Type } from "@google/genai";
import { ai } from "./_lib/gemini.js";
import { getClientIp, rateLimit } from "./_lib/rate-limit.js";
import { validateOptions } from "./_lib/validate.js";
import { withModelFallback } from "./_lib/retry.js";
import {
  StoryOptions,
  DURATION_DENSITY,
  CHOICE_PAGES,
  TOTAL_PAGES,
} from "../types.js";

// Back to the full Flash chain. The lite model was quick (~8s) but the
// story prose was noticeably flatter — the children's-book voice
// collapsed into generic storytelling. Full Flash takes ~50s for the
// one-shot book call; worth it for the voice. Keep lite as a last-
// resort fallback so an outage of the big models still produces a
// book, even a plainer one.
const TEXT_MODEL_CHAIN = [
  "gemini-3.8-flash",
  "gemini-flash-latest",
  "gemini-2.5-pro",
  "gemini-flash-lite-latest",
];

// Rotated per-request so stories don't all open the same way.
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
  "Vær mot andre slik du vil at andre skal være mot deg": [
    "behandle noen slik en selv liker å bli behandlet",
    "tenke seg om: hvordan ville jeg likt dette hvis det var meg?",
    "bytte plass i tankene med en annen før en handler",
    "gi det en selv ville satt pris på — et vennlig ord, en ekstra sjanse, en hjelpende hånd",
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

// Generous — one call writes plan + all 5 pages. Still well within Vercel's
// serverless cap, but we raise it from the 60s used by per-page endpoints.
export const maxDuration = 120;

// Full response schema: plan + exactly TOTAL_PAGES pages. Pages 1..CHOICE_PAGES
// carry two choices; the final page has no choices and sets isEnding=true.
const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    plan: {
      type: Type.OBJECT,
      properties: {
        logline: { type: Type.STRING },
        characterVoice: { type: Type.STRING },
        moralArc: { type: Type.STRING },
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
        },
        settingSeeds: { type: Type.ARRAY, items: { type: Type.STRING } },
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
    },
    pages: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          text: {
            type: Type.STRING,
            description:
              "The full page text in Norwegian. Must match pacing/density for the chosen duration.",
          },
          isEnding: { type: Type.BOOLEAN },
          illustrationPrompt: {
            type: Type.STRING,
            description:
              "Visual scene description in English. Action, setting, side characters present. Do NOT describe main character body/clothes — the illustrator has a reference sheet.",
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
                    "Short summary of how this choice COLORS the arrival at the next beat.",
                },
                bridge: {
                  type: Type.STRING,
                  description:
                    "1-2 Norwegian sentences shown on THIS page right after the choice is clicked — the immediate, concrete, sensory consequence that leads into the already-written next page.",
                },
              },
              required: ["text", "nextPlotPoint", "bridge"],
            },
            description:
              "Exactly 2 choices on choice pages; empty array on the resolution page.",
          },
        },
        required: ["text", "isEnding", "illustrationPrompt", "choices"],
      },
      description: `Nøyaktig ${TOTAL_PAGES} sider i rekkefølge: ${CHOICE_PAGES} valg-sider etterfulgt av 1 oppløsnings-side uten valg.`,
    },
  },
  required: ["plan", "pages"],
};

const SAFETY_RULES = `
VIKTIGE INNHOLDSREGLER (alltid):
- Innholdet er for barn og familier. Ingen vold, ingen trusler, ingen død, ingen skumle monstre som gjør vondt.
- Ingen voksne temaer (romantikk utover vennskap, politikk, religion, rus, kropp, penger utover sunne eksempler).
- Ingen vonde slutter. Alle karakterer skal være trygge til slutt.
- Mild spenning og problemer som løses er fint, men hold tonen varm og trygg.
- Ingen stereotypier eller fordommer om folk, land eller kultur.
- For aldersgruppen 1-3 år: svært enkle setninger, kjente ord, bare milde følelser, mye repetisjon.
- For 3-5 år: enkle setninger, lett spenning, tydelige løsninger.
- For 6-8 år: litt mer handling og humor, fortsatt uten noe skummelt.
`;

function buildSystemInstruction(options: StoryOptions, seed: number): string {
  const density = DURATION_DENSITY[options.duration];
  const openingArchetype = pick(OPENING_ARCHETYPES, seed);
  const climaxPattern = pick(CLIMAX_PATTERNS, seed >> 3);
  const angles = METAPHOR_ANGLES[options.metaphor] ?? [];
  const chosenAngle = angles.length ? pick(angles, seed >> 5) : "";

  return `Du er en varm, lekende norsk barnebokforfatter og dramaturg.
Du planlegger OG skriver hele den interaktive boka i én omgang.

Karakter: ${options.character}. Metafor: "${options.metaphor}". Aldersgruppe: ${options.ageGroup}.

FRØ (bruk — ikke avvik):
- Åpne historien ${openingArchetype}.
- Løs klimakset ${climaxPattern}.${
  chosenAngle
    ? `\n- Metafor-vinkel (ikke den første opplagte): ${chosenAngle}.`
    : ""
}

Du bestemmer setting og sjanger selv. Velg noe spesifikt og uventet.

STRUKTUR:
Boka har NØYAKTIG ${TOTAL_PAGES} sider: ${CHOICE_PAGES} valg-sider etterfulgt av 1 oppløsnings-side uten valg.
Planen definerer ${CHOICE_PAGES + 1} beats. Side N treffer beat N.
Det tredje beatet (side 3) er METAFOR-TESTEN — sett isMetaphorTest=true på det beatet.
Siste beat/side er oppløsningen, uten valg, isEnding=true, choices=[].

PERLE-STRUKTUR (kritisk — dette er HELE poenget med at hele boka skrives samtidig):
Hver side står på egne ben og leder til NESTE SIDE SLIK DEN ER SKREVET, uansett hvilket valg leseren tar.
Begge valgene på en side farger HVORDAN scenen oppleves (stemning, tilnærming, farger),
men IKKE HVA som faktisk skjer på neste side. Neste side er allerede skrevet — valget må lede dit.

TETTHET PR SIDE (varighet: ${options.duration}):
- Omtrent ${density?.sentences ?? "4-6"} setninger pr side.
- ${density?.miniScenes ?? 0} mini-scene(r) FØR valget på hver side.
- Pacing: ${density?.pacing ?? "balansert"}.

VALG-KVALITET pr side (unntatt siste):
- Nøyaktig 2 valg, aldri ett "feil" valg.
- "text" er en KORT knapp-label på norsk: 2-5 ord, maks ~30 tegn. En rask handling: "Innrømmer det ærlig", "Henter limtuben".
  IKKE en hel setning. IKKE en oppsummering.
- "nextPlotPoint" er en kort oppsummering av hvordan valget farger ankomsten til neste beat.
- "bridge" er 1-2 setninger på norsk som vises på DENNE siden rett etter at valget er klikket.
  Beskriv den umiddelbare, konkrete, sanselige konsekvensen av valget.
  MÅ lede naturlig videre mot teksten som allerede er skrevet på neste side — ikke motsi den.
  Konkret og sanselig, ikke abstrakt oppsummering.
- På siden merket metafor-test MÅ valgene handle om en konkret, levbar versjon av metaforen.

SPRÅK:
Bruk konkrete sanselige detaljer (lyd, lukt, farge, bevegelse) i stedet for abstrakte følelser.
"Han var redd" ❌  "Hjertet dunket som en lita tromme" ✓

ILLUSTRASJONER:
Hver side har en 'illustrationPrompt' på engelsk som beskriver scenens viktigste øyeblikk.
Beskriv handlingen og omgivelsene, og nevn eventuelle bikarakterer ved navn.
Beskriv IKKE hovedkarakterens klær eller kropp — illustratøren har et referanseark.

BIKARAKTERER:
0-2 navngitte bikarakterer, med grundig visuell bible på ENGELSK (farger, klær, tilbehør eksplisitt).
Bruk samme navn konsekvent gjennom boka hvis de dukker opp flere ganger.

SIDE 1 åpner historien konkret og sanselig gjennom åpnings-arketypen.
SIDE ${TOTAL_PAGES} (siste) runder av varmt, knytter sløyfen tilbake til åpningen og metaforen, ingen valg, isEnding=true, choices er en tom liste.
${SAFETY_RULES}`;
}

interface BookRequestBody {
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
    const body = (req.body ?? {}) as BookRequestBody;
    const options = validateOptions(body.options);
    if (!options) {
      return res.status(400).json({ error: "Ugyldige historievalg." });
    }

    const seed = Math.floor(Math.random() * 1_000_000);
    const systemInstruction = buildSystemInstruction(options, seed);
    const userPrompt = `Lag hele boka nå. Returner JSON etter skjemaet med én plan og nøyaktig ${TOTAL_PAGES} sider.`;

    const tGemini = Date.now();
    // One-shot generation of plan + all 5 pages is a much larger
    // response than a single /api/story page (~3000+ tokens of
    // structured JSON vs ~500). The default 20s per-attempt timeout
    // was killing calls that were still generating — raise to 60s
    // here so the model has room to finish.
    const response = await withModelFallback(
      TEXT_MODEL_CHAIN,
      (model) =>
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
        }),
      { timeoutMs: 60_000 }
    );
    const geminiMs = Date.now() - tGemini;

    if (!response.text) {
      throw new Error("Tomt svar fra Gemini");
    }

    const parsed = JSON.parse(response.text);

    // Belt-and-suspenders: clamp to exactly TOTAL_PAGES pages so the client
    // can always trust `pages.length === TOTAL_PAGES` and does not have to
    // guard against a model that produced one too many or one too few.
    const pages = Array.isArray(parsed.pages) ? parsed.pages.slice(0, TOTAL_PAGES) : [];
    while (pages.length < TOTAL_PAGES) {
      pages.push({
        text: "…",
        isEnding: pages.length === TOTAL_PAGES - 1,
        illustrationPrompt: "a cozy children's book scene",
        choices: [],
      });
    }
    // Force the last page shape: isEnding + no choices.
    const last = pages[TOTAL_PAGES - 1];
    last.isEnding = true;
    last.choices = [];
    // Non-final pages must have exactly 2 choices; if the model shorted us,
    // drop in a safe pair that still advances to the already-written next page.
    for (let i = 0; i < TOTAL_PAGES - 1; i++) {
      const p = pages[i];
      p.isEnding = false;
      if (!Array.isArray(p.choices) || p.choices.length < 2) {
        p.choices = [
          {
            text: "Fortsett rolig",
            nextPlotPoint: "går videre med rolig stemning",
            bridge: "Hen trakk pusten og gikk videre, nysgjerrig på hva som ventet.",
          },
          {
            text: "Fortsett ivrig",
            nextPlotPoint: "går videre med ivrig stemning",
            bridge: "Hen smilte bredt og tok et steg videre, ivrig etter å se hva som kom.",
          },
        ];
      } else {
        p.choices = p.choices.slice(0, 2);
      }
    }

    const totalMs = Date.now() - tStart;
    const prepMs = totalMs - geminiMs;
    console.log(
      `book.timing total=${totalMs}ms gemini=${geminiMs}ms prep=${prepMs}ms pages=${pages.length}`
    );
    res.setHeader(
      "Server-Timing",
      `prep;dur=${prepMs}, gemini;dur=${geminiMs}, total;dur=${totalMs}`
    );

    return res.status(200).json({ plan: parsed.plan, pages });
  } catch (error) {
    console.error("Book error:", error);
    const msg = error instanceof Error ? error.message : String(error);
    if (/UNAVAILABLE|high demand|503|timed out|timeout/i.test(msg)) {
      return res.status(503).json({
        error:
          "Historiefortelleren er veldig travel akkurat nå. Vent et minutt og prøv igjen.",
      });
    }
    return res
      .status(500)
      .json({ error: "Kunne ikke lage boka. Prøv igjen." });
  }
}
