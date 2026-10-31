import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ai, ART_STYLE, CHARACTER_DESCRIPTIONS } from "./_lib/gemini.js";
import { getClientIp, rateLimit } from "./_lib/rate-limit.js";

export const maxDuration = 60;

interface ImageRequestBody {
  prompt?: unknown;
  character?: unknown;
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
    return res.status(429).json({ error: "Du må vente litt." });
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

    const characterVisuals =
      (character && CHARACTER_DESCRIPTIONS[character]) ||
      "a cute children's book character";

    const fullPrompt = `
      Style: ${ART_STYLE}
      Character: ${characterVisuals}
      Scene: ${prompt}

      Ensure the character matches the description exactly. Maintain the watercolor art style. Keep the scene safe and age-appropriate for young children.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: { parts: [{ text: fullPrompt }] },
      config: {
        imageConfig: {
          aspectRatio: "3:4",
        },
      },
    });

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
