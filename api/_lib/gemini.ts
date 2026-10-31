import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  // Fail loud at cold start so we don't send unauthenticated requests.
  throw new Error("Missing GEMINI_API_KEY environment variable");
}

export const ai = new GoogleGenAI({ apiKey });

export const ART_STYLE =
  "children's book illustration, watercolor and ink style, soft pastel colors, white background, consistent character design, whimsical, cute";

export const CHARACTER_DESCRIPTIONS: Record<string, string> = {
  "Ninja-katten Nils":
    "a cute orange tabby cat wearing a black ninja headband and a small black belt, standing on two legs, holding a wooden sword",
  "Kongekrabba Kim":
    "a friendly red king crab wearing a tiny golden crown on its head, expressive big eyes, smiling",
  "Rom-hunden Rex":
    "a golden retriever dog wearing a silver space helmet and a small white astronaut suit",
  "Prinsesse Pølse":
    "a funny anthropomorphic sausage character with arms and legs, wearing a pink princess dress and a sparkling tiara",
  "Dragen Dagros":
    "a gentle, chubby dragon with black and white spots like a cow, wearing a cow bell around its neck, small wings, friendly",
  "Super-sneglen Sivert":
    "a fast-looking garden snail with a spiral shell, wearing a red superhero cape and a blue eye mask, dynamic pose, funny",
};
