
import { GoogleGenAI, Type, Chat, Modality } from "@google/genai";
import { StoryOptions, StorySegment } from "../types";

// Initialize the client
// Note: API key must be provided in process.env.API_KEY
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

let chatSession: Chat | null = null;
let currentCharacterVisuals = "";

// Consistent art style definition
const ART_STYLE = "children's book illustration, watercolor and ink style, soft pastel colors, white background, consistent character design, whimsical, cute";

// Visual descriptions for the predefined characters to ensure consistency
const CHARACTER_DESCRIPTIONS: Record<string, string> = {
  "Ninja-katten Nils": "a cute orange tabby cat wearing a black ninja headband and a small black belt, standing on two legs, holding a wooden sword",
  "Kongekrabba Kim": "a friendly red king crab wearing a tiny golden crown on its head, expressive big eyes, smiling",
  "Rom-hunden Rex": "a golden retriever dog wearing a silver space helmet and a small white astronaut suit",
  "Prinsesse Pølse": "a funny anthropomorphic sausage character with arms and legs, wearing a pink princess dress and a sparkling tiara",
  "Dragen Dagros": "a gentle, chubby dragon with black and white spots like a cow, wearing a cow bell around its neck, small wings, friendly",
  "Super-sneglen Sivert": "a fast-looking garden snail with a spiral shell, wearing a red superhero cape and a blue eye mask, dynamic pose, funny"
};

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    text: {
      type: Type.STRING,
      description: "The story segment text in Norwegian. Keep it engaging and appropriate for the age group.",
    },
    choices: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          text: { type: Type.STRING, description: "The text displayed on the button for the user to choose." },
          nextPlotPoint: { type: Type.STRING, description: "A short summary of what happens next if this choice is made." },
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
        description: "A detailed description of a visual scene to illustrate this part of the story (in English). Focus on the characters, setting, and action."
    }
  },
  required: ["text", "choices", "isEnding"],
};

// Helper function to generate an image based on the prompt
const generateIllustration = async (prompt: string): Promise<string | undefined> => {
  try {
    // Combine style, character description, and the specific scene prompt
    const fullPrompt = `
      Style: ${ART_STYLE}
      Character: ${currentCharacterVisuals}
      Scene: ${prompt}
      
      Ensure the character matches the description exactly. Maintain the watercolor art style.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [{ text: fullPrompt }]
      },
      config: {
        imageConfig: {
          aspectRatio: "3:4", // Portrait/Book page ratio
        }
      }
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        const base64EncodeString = part.inlineData.data;
        return `data:image/png;base64,${base64EncodeString}`;
      }
    }
    return undefined;
  } catch (error) {
    console.warn("Failed to generate illustration:", error);
    return undefined; // Fail gracefully, the UI handles missing images
  }
};

export const generateSpeech = async (text: string): Promise<string | undefined> => {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-preview-tts',
      contents: {
        parts: [{ text }]
      },
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' }
          }
        }
      }
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    return base64Audio;
  } catch (error) {
    console.error("Failed to generate speech:", error);
    return undefined;
  }
};

export const startNewStory = async (options: StoryOptions): Promise<StorySegment> => {
  // Set the visual context for this story
  currentCharacterVisuals = CHARACTER_DESCRIPTIONS[options.character] || `A cute version of ${options.character}`;

  let roleAndTone = `Du er en barnebokforfatter som skriver på norsk. 
  Du skal skrive en interaktiv historie for barn i alderen ${options.ageGroup}.
  Start historien nå med første del. Sørg for at språket er enkelt, lekent og engasjerende.`;

  // Override logic for 30+ age group to be satirical
  if (options.ageGroup === "30+") {
    roleAndTone = `Du er en kynisk satiriker og komiker som skriver for voksne (30+). 
    Du skal skrive en 'barnebok for voksne', men innholdet skal være gjennomsyret av:
    - Mørk humor og eksistensiell angst.
    - Sarkastiske stikk til norsk politikk, byråkrati, boligpriser eller samfunnstrender.
    - Tørrvittige observasjoner om voksenlivets skuffelser (tidsklemma, oppussing, skilsmisse, trening).
    - Ironisk distanse til karakterene.

    Formatet skal se ut som en uskyldig historie, men språket skal være skarpt, morsomt og brutalt ærlig. 
    Gjør narr av metaforen "${options.metaphor}" hvis det passer.
    
    Start historien nå med første del. Vær frekk og politisk ukorrekt.`;
  }

  const systemInstruction = `${roleAndTone}
  
  Historien skal handle om: ${options.character}.
  Temaet er: ${options.theme}.
  Sjangeren er: ${options.genre}.
  Den underliggende moralen/metaforen skal være: "${options.metaphor}".
  
  Ønsket varighet for historien er: ${options.duration}.
  Viktig: Tilpass lengden på historien basert på varigheten.
  - "Kort (ca. 2,5 min)": Sikt på ca 3-4 runder med valg før slutten.
  - "Middels (ca. 5 min)": Sikt på ca 6-8 runder med valg.
  - "Lang (ca. 10 min)": Sikt på ca 12-15 runder med valg.
  - "Ekstra lang (ca. 15 min)": Sikt på ca 20+ runder med valg.

  Skriv historien i segmenter. Hvert segment skal være ca. 3-5 setninger.
  På slutten av hvert segment (unntatt slutten), gi leseren 2 eller 3 valg for å drive handlingen videre.
  
  Inkluder en 'illustrationPrompt' på engelsk som beskriver scenen for en illustratør. Beskriv handlingen og omgivelsene, men du trenger ikke beskrive karakterens utseende i detalj hver gang, da illustratøren kjenner karakteren.`;

  chatSession = ai.chats.create({
    model: "gemini-2.5-flash",
    config: {
      systemInstruction: systemInstruction,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  });

  try {
    const response = await chatSession.sendMessage({ message: "Start historien." });
    if (!response.text) throw new Error("No response from Gemini");
    
    const segment = JSON.parse(response.text) as StorySegment;

    // Generate image if prompt exists
    if (segment.illustrationPrompt) {
      const imageBase64 = await generateIllustration(segment.illustrationPrompt);
      if (imageBase64) {
        segment.imageBase64 = imageBase64;
      }
    }

    return segment;
  } catch (error) {
    console.error("Error starting story:", error);
    throw error;
  }
};

export const continueStory = async (choiceSummary: string): Promise<StorySegment> => {
  if (!chatSession) {
    throw new Error("No active story session");
  }

  try {
    const message = `Brukeren valgte: "${choiceSummary}". Fortsett historien basert på dette valget. Hvis historien føles ferdig basert på valgt varighet, eller metaforen er tydelig formidlet, kan du avslutte historien nå ved å sette isEnding til true. Husk 'illustrationPrompt' på engelsk.`;
    
    const response = await chatSession.sendMessage({ message });
    if (!response.text) throw new Error("No response from Gemini");

    const segment = JSON.parse(response.text) as StorySegment;

    // Generate image if prompt exists
    if (segment.illustrationPrompt) {
      const imageBase64 = await generateIllustration(segment.illustrationPrompt);
      if (imageBase64) {
        segment.imageBase64 = imageBase64;
      }
    }

    return segment;
  } catch (error) {
    console.error("Error continuing story:", error);
    throw error;
  }
};
