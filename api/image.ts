import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  ai,
  artStyleFor,
  FRAMING_RULE,
  parseDataUrl,
} from "./_lib/gemini.js";
import { heroBible, openHero } from "./_lib/hero.js";
import { getClientIp, rateLimit } from "./_lib/rate-limit.js";
import { allowedArtStyle, mayPersonalize } from "./_lib/access.js";
import { readSession } from "./_lib/session.js";
import { spend } from "./_lib/budget.js";
import { withRetry } from "./_lib/retry.js";

export const maxDuration = 60;

interface SideCharacterInput {
  name: string;
  bible: string;
}

interface ImageRequestBody {
  prompt?: unknown;
  character?: unknown;
  // Base64 data URL of the canonical character sheet. Sent back on every call.
  characterSheet?: unknown;
  // Side characters that may appear in this scene; each carries a full visual bible.
  sideCharacters?: unknown;
  // Drawing style picked for this story (label from ART_STYLES).
  artStyle?: unknown;
  // Set when the hero was made from a photo (see _lib/hero.ts).
  heroToken?: unknown;
  // The ticket of a «Magihistorie» made on the free plan.
  billett?: unknown;
}

function parseSideCharacters(input: unknown): SideCharacterInput[] {
  if (!Array.isArray(input)) return [];
  const out: SideCharacterInput[] = [];
  for (const item of input.slice(0, 3)) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.name === "string" && typeof row.bible === "string") {
      out.push({
        name: row.name.slice(0, 80),
        bible: row.bible.slice(0, 1500),
      });
    }
  }
  return out;
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

  // Guests get pictures for the pages they may read (see GUEST_PAGES).
  const session = readSession(req);

  const limit = rateLimit(getClientIp(req));
  if (!limit.ok) {
    res.setHeader("Retry-After", String(limit.retryAfter ?? 60));
    return res.status(429).json({ error: "Du må vente litt." });
  }

  // Daily spending cap (see _lib/budget.ts).
  const budget = await spend(req, "image", !session);
  if (!budget.ok) {
    return res.status(429).json({ error: budget.message });
  }

  try {
    const body = (req.body ?? {}) as ImageRequestBody;
    const prompt =
      typeof body.prompt === "string" ? body.prompt.slice(0, 1000) : null;
    const character =
      typeof body.character === "string" ? body.character : null;

    if (!prompt) {
      return res.status(400).json({ error: "Mangler scenebeskrivelse." });
    }

    // A hero made from a photo belongs to «Magihistorie» and Prinsen.
    if (openHero(body.heroToken) && !(await mayPersonalize(session, body.billett))) {
      return res.status(403).json({ error: "Egen helt er med i magihistorier og Prinsen." });
    }
    // A hero made from a photo is only called by its name in the scene.
    const ownHero = openHero(body.heroToken);
    const characterVisuals = ownHero
      ? `Name: ${ownHero.name} (this is who "${ownHero.name}" in the scene is).\n${ownHero.bible}`
      : heroBible(character, null) || "a cute children's book character";

    const sideCharacters = parseSideCharacters(body.sideCharacters);
    const sideCharsBlock = sideCharacters.length
      ? `\nSide characters in this scene (follow each bible exactly, same look on every page they appear):\n${sideCharacters
          .map(
            (s) =>
              `  - ${s.name}:\n${s.bible
                .split("\n")
                .map((l) => `      ${l}`)
                .join("\n")}`
          )
          .join("\n")}\n`
      : "";

    const sheet = parseDataUrl(body.characterSheet);

    // Other drawing styles than the standard one are for Pro.
    const artStyle = await allowedArtStyle(
      session,
      body.artStyle,
      body.billett
    );

    const referenceNote = sheet
      ? "\nA REFERENCE IMAGE of the main character is attached. The character in the scene MUST match this reference exactly — same colors, same clothing items, same accessories, same body proportions. Do not deviate.\n"
      : "";

    const fullPrompt = `
Style: ${artStyleFor(artStyle)}

Main character bible (follow EXACTLY — never add, change or remove any item):
${characterVisuals}
${sideCharsBlock}${referenceNote}
${FRAMING_RULE}

Scene to illustrate: ${prompt}

Rules:
- Keep the main character visually identical to the reference and bible above.
- Keep every side character identical to its bible each time it appears.
- Keep the art style described under "Style" above, the same on every page, and consistent character scale.
- Keep the scene safe and age-appropriate for young children.
- If the scene has a sentence starting with "Reader's choice:", the reader picked that look for this book. Always show it clearly. It is the one allowed addition to the character bible (for example a scarf in the chosen colour), and it overrides the "clean white background" style when it is about weather or time of day.
`;

    const parts: Array<
      { text: string } | { inlineData: { mimeType: string; data: string } }
    > = [];
    if (sheet) {
      parts.push({ inlineData: sheet });
    }
    parts.push({ text: fullPrompt });

    const response = await withRetry(() =>
      ai.models.generateContent({
        model: "gemini-2.5-flash-image",
        contents: { parts },
        config: {
          imageConfig: {
            aspectRatio: "3:4",
          },
        },
      })
    );

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return res.status(200).json({
          base64: `data:image/png;base64,${part.inlineData.data}`,
        });
      }
    }

    return res.status(200).json({ base64: null });
  } catch (error) {
    console.error("Image error:", error);
    return res.status(500).json({ error: "Kunne ikke lage bildet." });
  }
}
