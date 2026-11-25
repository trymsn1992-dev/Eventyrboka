import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Modality } from "@google/genai";
import { ai } from "./_lib/gemini.js";
import { getClientIp, rateLimit } from "./_lib/rate-limit.js";
import {
  mayReadAloud,
  outOfWishes,
  readAloudPass,
  requireLogin,
  spendWishes,
  validStoryKey,
} from "./_lib/access.js";
import { getAccount } from "./_lib/supabase.js";
import { spend } from "./_lib/budget.js";
import { withRetry } from "./_lib/retry.js";

export const maxDuration = 60;

const MAX_TEXT_LENGTH = 2000;

// POST with one of:
//   { kjop: true, historie: <key> }         pay a wish for read-aloud of this
//                                           story                -> { lesepass }
//   { text, historie, lesepass }            one page read aloud  -> { base64 }
// `historie` is the story's seed. Stories from before wishes send `billett`.
interface SpeechRequestBody {
  text?: unknown;
  kjop?: unknown;
  historie?: unknown;
  lesepass?: unknown;
  billett?: unknown;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
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
  const request = (req.body ?? {}) as SpeechRequestBody;

  // Read-aloud of a story costs one wish, once. Nothing is made here, so
  // there is nothing that can fail after the wish is taken.
  if (request.kjop === true) {
    if (!validStoryKey(request.historie)) {
      return res.status(400).json({ error: "Mangler historie." });
    }
    const { plan } = await getAccount(session.sub);
    if (!(await spendWishes(session.sub, 1, plan))) {
      return res.status(429).json(outOfWishes(1));
    }
    return res.status(200).json({ lesepass: readAloudPass(session.sub, request.historie) });
  }

  if (!mayReadAloud(session, request)) {
    return res.status(403).json({ error: "Opplesning av en historie koster et ønske." });
  }

  // Daily spending cap (see _lib/budget.ts).
  const budget = await spend(req, "speech", session);
  if (!budget.ok) {
    return res.status(429).json({ error: budget.message });
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
