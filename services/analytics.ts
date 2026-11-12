// Usage measurement with Vercel Web Analytics: page views plus a handful of
// named events, so we can see how far people get (started -> pages read ->
// finished -> saved). It uses no cookies and stores nothing about who the
// visitor is.
//
// Rules for what goes in an event:
//  - Never anything typed by the user (a custom moral is logged as "Egen").
//  - At most two values per event — that is what the plan allows.
import { inject, track } from "@vercel/analytics";
import { METAPHORS, StoryOptions } from "../types";

type EventData = Record<string, string | number | boolean | null>;

let started = false;

// Call once when the app starts.
export function startAnalytics(): void {
  if (started) return;
  started = true;
  try {
    inject();
  } catch {
    // Measurement must never break the app.
  }
}

export function logEvent(name: string, data?: EventData): void {
  try {
    track(name, data);
  } catch {
    // ignore
  }
}

// A new story: who, what about, and for whom.
export function logStoryStarted(options: StoryOptions): void {
  logEvent("Eventyr startet", {
    helt: options.character,
    moral: METAPHORS.includes(options.metaphor) ? options.metaphor : "Egen",
  });
  logEvent("Eventyr innstillinger", {
    alder: options.ageGroup,
    stil: options.artStyle ?? "Akvarell",
  });
  logEvent("Eventyr lengde", { lengde: options.duration });
}
