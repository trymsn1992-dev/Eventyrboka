// Takes the insight row of one story (see services/insight.ts) and hands it
// to the database, which keeps the furthest page and never un-finishes a
// story. Open to everyone — guests read too — so everything is checked
// against what the app can actually send, and nothing identifies the reader.
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

const ONE_OF: Record<string, readonly string[]> = {
  helt: CHARACTERS,
  moral: [...METAPHORS, "Egen"],
  alder: [...AGE_GROUPS, ...LEGACY_AGE_GROUPS],
  stil: ART_STYLES,
  lengde: DURATIONS,
  type: ["vanlig", "magi"],
  hvem: ["gjest", "askeladden", "prinsen"],
  enhet: ["mobil", "pc"],
};
const FLAGS = ["kjopt", "ferdig", "avsluttet_tidlig", "lagret", "les_hoyt", "logget_inn"];
const NUMBERS: Record<string, [number, number]> = {
  sider: [1, 30],
  stjerner: [1, 5],
  sekunder: [0, 24 * 60 * 60],
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!rateLimit(`innsikt:${getClientIp(req)}`).ok) return res.status(429).end();

  const body = (req.body ?? {}) as Record<string, unknown>;
  if (typeof body.id !== "string" || !UUID.test(body.id)) return res.status(400).end();

  // Only what is known and well-formed goes on; the rest is dropped.
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
  if (typeof body.valg === "string" && /^(-?\d)(,-?\d){0,29}$/.test(body.valg)) row.valg = body.valg;

  await quotaRpc<boolean>("logg_innsikt", { p: row });
  return res.status(204).end();
}
