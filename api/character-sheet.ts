import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  ai,
  artStyleFor,
  CHARACTER_DESCRIPTIONS,
  FRAMING_RULE,
} from "./_lib/gemini.js";
import { getClientIp, rateLimit } from "./_lib/rate-limit.js";
import { allowedArtStyle, requireLogin } from "./_lib/access.js";
import { spend } from "./_lib/budget.js";
import { withRetry } from "./_lib/retry.js";

export const maxDuration = 60;

interface CharacterSheetRequestBody {
  character?: unknown;
  // Drawing style picked for this story (label from ART_STYLES).
  artStyle?: unknown;
}

// Generates a single canonical "character sheet" image for the main character.
// This image is sent as a reference input alongside every subsequent scene
// generation so Gemini can lock the character's look, scale, colors, clothes
// and accessories across every page of the book.
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

  const session = requireLogin(req, res);
  if (!session) return;

  const limit = rateLimit(getClientIp(req));
  if (!limit.ok) {
    res.setHeader("Retry-After", String(limit.retryAfter ?? 60));
    return res.status(429).json({ error: "Du må vente litt." });
  }

  // Daily spending cap (see _lib/budget.ts).
  const budget = await spend(req, "image");
  if (!budget.ok) {
    return res.status(429).json({ error: budget.message });
  }

  try {
    const body = (req.body ?? {}) as CharacterSheetRequestBody;
    const character =
      typeof body.character === "string" ? body.character : null;

    if (!character || !CHARACTER_DESCRIPTIONS[character]) {
      return res.status(400).json({ error: "Ukjent karakter." });
    }

    const bible = CHARACTER_DESCRIPTIONS[character];
    // Other drawing styles than the standard one are for Pro.
    const artStyle = await allowedArtStyle(session.sub, body.artStyle);

    const sheetPrompt = `
This is a CHARACTER REFERENCE SHEET for a children's picture book. Draw ONE character,
front view, standing centered on a plain white background, full body visible from head to toe.
Neutral friendly pose, calm expression, soft natural lighting.

Style: ${artStyleFor(artStyle)}

Character bible (follow EXACTLY, do not add or omit anything):
${bible}

${FRAMING_RULE}

IMPORTANT: this is the canonical reference. Nothing else in the frame — no background scenery,
no props the character does not carry, no other characters. Just the character on white.
`;

    const response = await withRetry(() =>
      ai.models.generateContent({
        model: "gemini-2.5-flash-image",
        contents: { parts: [{ text: sheetPrompt }] },
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
    console.error("Character sheet error:", error);
    return res.status(500).json({ error: "Kunne ikke lage karakter-arket." });
  }
}
