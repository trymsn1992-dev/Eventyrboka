// A story made without a login is saved by logging in, so it has to survive
// the trip to Vipps and back, which reloads the page. It is put in localStorage (not sessionStorage:
// on mobile Vipps may return in a new tab) right before the reader leaves,
// and taken out again on the next load.
import { StoryOptions, StorySegment } from "../types";
import { compressImage } from "./account";

export interface PendingStory {
  options: StoryOptions;
  segments: StorySegment[];
  chosenByPage: Record<number, number>;
  seed: number;
  premise: string;
  pageIndex: number;
  // The character sheet, so later pictures match the first ones.
  sheet?: string;
}

const KEY = "magiboka_gjestehistorie";
const MAX_AGE_MS = 2 * 60 * 60 * 1000;
// How long the login may be held back while the pictures are made smaller.
const SHRINK_WAIT_MS = 4000;
// A whole story's pictures have to fit in localStorage (about 2.5 million
// characters in Safari), so they are kept a little smaller than usual.
const PENDING_IMAGE_PX = 1024;

const shrink = async (image: string | undefined): Promise<string | undefined> =>
  image && image.startsWith("data:") ? compressImage(image, PENDING_IMAGE_PX) : undefined;

export async function savePendingStory(story: PendingStory): Promise<void> {
  const write = (s: PendingStory) =>
    localStorage.setItem(KEY, JSON.stringify({ ...s, savedAt: Date.now() }));
  const withoutImages: PendingStory = {
    ...story,
    sheet: undefined,
    segments: story.segments.map(({ imageBase64: _image, ...rest }) => rest),
  };
  // The text first: that always fits and never has to wait.
  try {
    write(withoutImages);
  } catch {
    // Private mode — the story won't survive the login.
    return;
  }
  // Then the pictures, if they can be made small in time and there is room.
  // Otherwise the text stays, and the picture on screen is drawn again.
  try {
    const withImages = await Promise.race([
      (async (): Promise<PendingStory> => {
        const images = await Promise.all(story.segments.map((s) => shrink(s.imageBase64)));
        return {
          ...withoutImages,
          sheet: await shrink(story.sheet),
          segments: withoutImages.segments.map((s, i) =>
            images[i] ? { ...s, imageBase64: images[i] } : s
          ),
        };
      })(),
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), SHRINK_WAIT_MS)),
    ]);
    if (withImages) write(withImages);
  } catch {
    // Keep the text version.
  }
}

let taken: PendingStory | null | undefined;

// The story waiting from before the login, if any. It is removed from
// storage on the first call; later calls return the same answer.
export function takePendingStory(): PendingStory | null {
  if (taken !== undefined) return taken;
  taken = null;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    localStorage.removeItem(KEY);
    if (
      raw &&
      typeof raw === "object" &&
      typeof raw.savedAt === "number" &&
      Date.now() - raw.savedAt < MAX_AGE_MS &&
      raw.options &&
      typeof raw.options === "object" &&
      Array.isArray(raw.segments) &&
      raw.segments.length > 0 &&
      raw.segments.every(
        (s: unknown) =>
          s &&
          typeof s === "object" &&
          typeof (s as StorySegment).text === "string" &&
          Array.isArray((s as StorySegment).choices)
      ) &&
      typeof raw.seed === "number"
    ) {
      const pageIndex = Number.isInteger(raw.pageIndex) ? raw.pageIndex : 0;
      taken = {
        options: raw.options,
        segments: raw.segments,
        chosenByPage:
          raw.chosenByPage && typeof raw.chosenByPage === "object" ? raw.chosenByPage : {},
        seed: raw.seed,
        premise: typeof raw.premise === "string" ? raw.premise : "",
        pageIndex: Math.min(Math.max(0, pageIndex), raw.segments.length - 1),
        sheet: typeof raw.sheet === "string" ? raw.sheet : undefined,
      };
    }
  } catch {
    // Nothing usable stored.
  }
  return taken;
}
