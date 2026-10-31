import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Modality } from "@google/genai";
import { ai } from "./_lib/gemini.js";
import { getClientIp, rateLimit } from "./_lib/rate-limit.js";
import { withRetry } from "./_lib/retry.js";

export const maxDuration = 60;

const MAX_TEXT_LENGTH = 2000;

interface SpeechRequestBody {
  text?: unknown;
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
    const body = (req.body ?? {}) as SpeechRequestBody;
    const text = typeof body.text === "string" ? body.text : null;

    if (!text) {
      return res.status(400).json({ error: "Mangler tekst." });
    }

    if (text.length > MAX_TEXT_LENGTH) {
      return res.status(400).json({ error: "Teksten er for lang." });
    }

    const response = await withRetry(() =>
      ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: { parts: [{ text }] },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: "Kore" },
            },
          },
        },
      })
    );

    const base64Audio =
      response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

    return res.status(200).json({ base64: base64Audio ?? null });
  } catch (error) {
    console.error("Speech error:", error);
    return res.status(500).json({ error: "Kunne ikke lage lyd." });
  }
}
