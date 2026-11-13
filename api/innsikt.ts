// Takes insight from the app (see services/insight.ts) and hands it to the
// database: the row of one story, or one event outside the story. Open to
// everyone — guests read too — so everything is checked against what the app
// can actually send, and nothing identifies the reader.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getClientIp, rateLimit } from "./_lib/rate-limit.js";
import { quotaRpc } from "./_lib/supabase.js";
import {
  AGE_GROUPS,
  ART_STYLES,
  CHARACTERS,
  DURATIONS,
  LEGACY_AGE_GROUPS,
  METAPHORS,
} from "../types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A source or campaign: what services/insight.ts lets through.
const TAG = /^[a-z0-9æøå._-]{1,40}$/;
const WHO = ["gjest", "askeladden", "prinsen"];

const ONE_OF: Record<string, readonly string[]> = {
  helt: [...CHARACTERS, "Egen"],
  moral: [...METAPHORS, "Egen"],
  alder: [...AGE_GROUPS, ...LEGACY_AGE_GROUPS],
  stil: ART_STYLES,
  lengde: DURATIONS,
  type: ["vanlig", "magi"],
  hvem: WHO,
  enhet: ["mobil", "pc"],
  stoppet: ["feil", "kvote", "innlogging"],
};
const FLAGS = [
  "kjopt", "ferdig", "avsluttet_tidlig", "lagret", "les_hoyt", "logget_inn", "vegg_sett", "vegg_klikket",
];
const NUMBERS: Record<string, [number, number]> = {
  sider: [0, 30],
  stjerner: [1, 5],
  sekunder: [0, 24 * 60 * 60],
  vent_start_ms: [0, 10 * 60 * 1000],
  bilder_manglet: [0, 30],
  feil: [0, 100],
};
const LISTS: Record<string, RegExp> = {
  valg: /^(-?\d)(,-?\d){0,29}$/,
  vent_sider: /^\d{1,6}(,\d{1,6}){0,29}$/,
};

// The events the app logs outside the story (the names used with logEvent).
const EVENTS = new Set([
  "Besøk",
  "Kvote truffet",
  "Lås truffet",
  "Plansiden åpnet",
  "Plan valgt",
  "Kjøp startet",
  "Kjøp ønsket",
  "Historie kjøpt",
  "Kjøp avbrutt",
  "Prinsen-kjøp startet",
  "Prinsen kjøpt",
  "Prinsen sagt opp",
  "Prinsen-interesse",
  "Prinsen-lenke brukt",
  "Innlogging bedt om",
  "Vipps-innlogging klikket",
  "Oppstart feilet",
  "Min side åpnet",
  "Lagret eventyr åpnet",
]);
const DETAIL = /^[\p{L}\p{N} ._-]{1,40}$/u;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!rateLimit(`innsikt:${getClientIp(req)}`).ok) return res.status(429).end();

  const body = (req.body ?? {}) as Record<string, unknown>;
  const tag = (key: string) => {
    const value = body[key];
    return typeof value === "string" && TAG.test(value) ? value : undefined;
  };

  // An event outside the story.
  if (typeof body.hendelse === "string") {
    if (!EVENTS.has(body.hendelse)) return res.status(400).end();
    await quotaRpc<boolean>("logg_hendelse", {
      p: {
        navn: body.hendelse,
        detalj: typeof body.detalj === "string" && DETAIL.test(body.detalj) ? body.detalj : undefined,
        hvem: typeof body.hvem === "string" && WHO.includes(body.hvem) ? body.hvem : undefined,
        kilde: tag("kilde"),
        kampanje: tag("kampanje"),
      },
    });
    return res.status(204).end();
  }

  // The row of one story. Only what is known and well-formed goes on.
  if (typeof body.id !== "string" || !UUID.test(body.id)) return res.status(400).end();
  const row: Record<string, string | number | boolean> = { id: body.id.toLowerCase() };
  for (const [key, allowed] of Object.entries(ONE_OF)) {
    const value = body[key];
    if (typeof value === "string" && allowed.includes(value)) row[key] = value;
  }
  for (const key of FLAGS) {
    if (body[key] === true) row[key] = true;
  }
  for (const [key, [min, max]] of Object.entries(NUMBERS)) {
    const value = body[key];
    if (typeof value === "number" && Number.isInteger(value) && value >= min && value <= max) row[key] = value;
  }
  for (const [key, shape] of Object.entries(LISTS)) {
    const value = body[key];
    if (typeof value === "string" && shape.test(value)) row[key] = value;
  }
  for (const key of ["kilde", "kampanje"]) {
    const value = tag(key);
    if (value) row[key] = value;
  }

  await quotaRpc<boolean>("logg_innsikt", { p: row });
  return res.status(204).end();
}
