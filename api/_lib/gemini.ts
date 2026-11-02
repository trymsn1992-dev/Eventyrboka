import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  // Fail loud at cold start so we don't send unauthenticated requests.
  throw new Error("Missing GEMINI_API_KEY environment variable");
}

export const ai = new GoogleGenAI({ apiKey });

export const ART_STYLE =
  "children's book illustration, watercolor and ink style, soft pastel colors, clean white background, whimsical, cute, consistent character scale across pages";

// Full visual bibles for each main character. These are repeated verbatim on EVERY image
// prompt so the model has no excuse to drift between pages. Every item is intentional:
// - Species / proportions lock the silhouette
// - Clothing list is exhaustive so nothing can be invented or dropped
// - Accessories list is exhaustive so nothing can be invented or dropped
// - ALWAYS / NEVER lines teach the model what is forbidden to change
export const CHARACTER_DESCRIPTIONS: Record<string, string> = {
  "Ninja-katten Nils": `
Species: an orange tabby cat, standing upright on two legs like a toddler, cartoon proportions with a big head and small body.
Fur: warm burnt-orange tabby stripes on back and tail, cream chest and belly, cream inside the ears.
Face: round cheeks, large expressive emerald-green eyes, small pink triangular nose, three thin whiskers on each side, tiny mouth with a gentle smile.
Clothing (exhaustive — never add any other garment):
  - Black cotton ninja headband tied around the forehead, two short tails trailing behind.
  - Black fabric belt around the waist.
  - No shirt, no pants, no shoes — bare orange fur elsewhere.
Accessories (exhaustive — never add any other item):
  - A small plain wooden sword (katana shape), always carried in the right paw or strapped diagonally across the back.
ALWAYS include: the black headband, the black belt, and the wooden sword.
NEVER: add shoes, add a shirt, change the belt color, make the sword metal, add a mask, change eye color, or add any other accessory.
`,
  "Kongekrabba Kim": `
Species: a friendly red king crab, round body, four pairs of walking legs, two front claws held upright, standing on the rear legs cartoon-style.
Shell: deep tomato red with lighter red speckles; small spines on top drawn soft and non-threatening.
Face: two black bead eyes on short stalks with white highlights, wide happy smile, soft cheeks blush dot.
Clothing (exhaustive — never add any other garment):
  - A tiny golden five-point crown with three rounded tips, sitting between the eye stalks.
  - No other clothing.
Accessories: none beyond the crown.
ALWAYS include: the small golden crown; both claws visible; red shell color.
NEVER: add glasses, a cape, a scepter, change the crown color, make the crab blue or purple, or draw sharp menacing claws.
`,
  "Rom-hunden Rex": `
Species: a golden retriever dog, standing upright on hind legs cartoon-style, soft rounded proportions.
Fur: golden-yellow, slightly fluffy, lighter cream around the muzzle and chest.
Face: floppy ears hanging down, warm brown eyes, black nose, pink tongue slightly showing in a happy smile.
Clothing (exhaustive — never add any other garment):
  - A white astronaut spacesuit covering body and legs, with a round NASA-style patch on the chest (plain, no text).
  - A silver space helmet with a clear glass dome; floppy ears visible through or around the helmet.
  - White gloves and small white boots as part of the suit.
Accessories: none beyond the suit and helmet.
ALWAYS include: silver helmet with clear dome, white suit, chest patch.
NEVER: remove the helmet, change suit color, add a jetpack, change the dog breed, or add a leash.
`,
  "Prinsesse Pølse": `
Species: an anthropomorphic hot-dog sausage character — a brown sausage body standing upright with two short arms and two short legs; cartoon style, friendly.
Body: medium brown sausage color with lighter highlights; smooth texture; no bun.
Face: large black bead eyes with white highlights, long curled eyelashes, small smiling mouth with rosy cheeks painted on.
Clothing (exhaustive — never add any other garment):
  - A pink princess ball-gown with puffed short sleeves, worn around the middle of the sausage body, hem reaching the ankles.
  - A sparkling golden tiara with a single pink gem in the center, sitting on the top of the sausage head.
  - Tiny white gloves on the hands.
Accessories: none beyond gown, tiara and gloves.
ALWAYS include: pink gown, tiara with pink gem, white gloves.
NEVER: add a bun, add shoes other than tiny slippers if needed, change gown color, change tiara color, add a wand.
`,
  "Dragen Dagros": `
Species: a gentle, chubby dragon in cow coloring, standing on four legs or sometimes upright on hind legs; soft rounded body like a plush toy.
Scales: white body covered with irregular soft black patches like a dairy cow; pink belly and inner wings; small rounded horns.
Face: huge friendly round eyes with long eyelashes, small nose, gentle smile, pink cheeks.
Clothing (exhaustive — never add any other garment):
  - A brown leather collar around the neck with a dangling small brass cow bell.
Accessories: none beyond the collar and bell.
Wings: small chubby wings with pink membrane, usually tucked.
ALWAYS include: cow-pattern patches, pink belly, collar with cow bell, small chubby wings.
NEVER: change color to green or red, remove the cow bell, make the dragon scary, give it fire breath on the page, add armor.
`,
  "Super-sneglen Sivert": `
Species: a smiling garden snail with a tall spiral shell; cartoon proportions; moves with a trail of tiny white speed lines behind.
Body: soft gray-green snail body with a hint of shimmer; two tall eye-stalks with round eyes; small smile.
Shell: brown-and-cream spiral shell, high and prominent, with a visible stripe pattern.
Clothing (exhaustive — never add any other garment):
  - A red superhero cape attached at the top of the shell, flowing behind.
  - A blue domino eye mask across the eye-stalks area.
Accessories: none beyond cape and mask.
ALWAYS include: red cape attached to the shell, blue eye mask, dynamic forward-leaning pose.
NEVER: remove the shell, make the snail a different color, change cape color, add a superhero emblem letter, give it legs.
`,
};

// Framing rule injected into every image prompt so size and composition stay stable.
export const FRAMING_RULE =
  "Framing: medium shot, main character fills roughly 55-65% of the frame vertically, same scale across all pages of the book, character fully visible, calm readable composition suitable for a children's book spread.";
