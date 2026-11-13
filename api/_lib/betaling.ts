// Payment with Vipps: single stories (ePayment API) and the Prinsen
// subscription (Recurring API v3). Both use the same keys as the login, plus
// VIPPS_SUBSCRIPTION_KEY and VIPPS_MSN. Each is switched on by its own env
// var, so nothing is sold before Vipps has approved the product:
//   VIPPS_BETALING=1     single stories
//   VIPPS_ABONNEMENT=1   Prinsen
// The tables (kjop, avtaler) are in supabase/schema.sql.
import { randomBytes } from "node:crypto";
import type { VercelRequest } from "@vercel/node";
import { systemHeaders, vippsClientId, vippsClientSecret, vippsReady } from "./vipps.js";
import { getAccount, quotaRpc, setPlan, supabaseReady, tableRequest } from "./supabase.js";
import {
  PERSONAL_STORY_NAME,
  PLAN_NAMES,
  PRICE_PERSONAL_STORY_KR,
  PRICE_PRINSEN_PER_WEEK_KR,
  PRICE_SIMPLE_STORY_KR,
  STORY_NAME,
} from "../../types.js";

const env = (name: string) => (process.env[name] || "").trim();
const switchedOn = (name: string) => ["1", "true", "på"].includes(env(name).toLowerCase());

const keysReady = () =>
  vippsReady() && supabaseReady() && Boolean(env("VIPPS_SUBSCRIPTION_KEY") && env("VIPPS_MSN"));

export const purchasesReady = () => keysReady() && switchedOn("VIPPS_BETALING");
export const subscriptionReady = () => keysReady() && switchedOn("VIPPS_ABONNEMENT");

const baseUrl = () =>
  env("VIPPS_MILJO") === "prod" ? "https://api.vipps.no" : "https://apitest.vipps.no";

// Where Vipps sends the user back to: the site the request came from.
export function siteOrigin(req: VercelRequest): string {
  return `https://${(req.headers["x-forwarded-host"] || req.headers.host) as string}`;
}

// ---- Talking to Vipps -----------------------------------------------------

let cachedToken: { value: string; expires: number } | null = null;

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expires > Date.now() + 60_000) return cachedToken.value;
  const r = await fetch(`${baseUrl()}/accesstoken/get`, {
    method: "POST",
    headers: {
      client_id: vippsClientId(),
      client_secret: vippsClientSecret(),
      ...systemHeaders(),
    },
  });
  if (!r.ok) {
    throw new Error(`fikk ikke tilgangsnøkkel fra Vipps (HTTP ${r.status}): ${(await r.text()).slice(0, 200)}`);
  }
  const data = (await r.json()) as { access_token: string; expires_in?: string | number };
  const seconds = Number(data.expires_in) || 600;
  cachedToken = { value: data.access_token, expires: Date.now() + seconds * 1000 };
  return cachedToken.value;
}

// One call to Vipps. `idempotencyKey` is required by Vipps for everything
// that creates or changes something; the same key twice does it only once.
async function vipps<T>(
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: Record<string, unknown>,
  idempotencyKey?: string
): Promise<T> {
  const r = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      ...systemHeaders(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) {
    throw new Error(`Vipps ${method} ${path} svarte HTTP ${r.status}: ${text.slice(0, 300)}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

// ---- Dates (Norwegian time, as YYYY-MM-DD) ---------------------------------

export const today = (): string =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo" }).format(new Date());

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const daysUntil = (date: string): number =>
  Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today()}T12:00:00Z`)) / 86_400_000);

// ---- Single stories --------------------------------------------------------

export type PurchaseKind = "historie" | "din-historie";

export const isPurchaseKind = (v: unknown): v is PurchaseKind =>
  v === "historie" || v === "din-historie";

const PURCHASE: Record<PurchaseKind, { ore: number; name: string }> = {
  historie: { ore: PRICE_SIMPLE_STORY_KR * 100, name: STORY_NAME },
  "din-historie": { ore: PRICE_PERSONAL_STORY_KR * 100, name: PERSONAL_STORY_NAME },
};

interface PurchaseRow {
  referanse: string;
  vipps_sub: string;
  type: PurchaseKind;
  belop: number;
  status: "opprettet" | "betalt" | "avbrutt";
}

// Sends the buyer to Vipps: returns the address to open, or null on failure.
export async function startPurchase(
  vippsSub: string,
  kind: PurchaseKind,
  origin: string
): Promise<string | null> {
  const reference = `mb-${randomBytes(16).toString("hex")}`;
  const { ore, name } = PURCHASE[kind];
  // The row first: a payment we have no record of could never be delivered.
  const saved = await tableRequest("POST", "kjop", "", {
    referanse: reference,
    vipps_sub: vippsSub,
    type: kind,
    belop: ore,
  });
  if (!saved) return null;
  try {
    const payment = await vipps<{ redirectUrl?: string }>(
      "POST",
      "/epayment/v1/payments",
      {
        amount: { value: ore, currency: "NOK" },
        paymentMethod: { type: "WALLET" },
        reference,
        userFlow: "WEB_REDIRECT",
        returnUrl: `${origin}/?betalt=${reference}`,
        paymentDescription: `Magiboka – ${name}`,
      },
      reference
    );
    return payment.redirectUrl || null;
  } catch (err) {
    console.error("Vipps-kjøp kunne ikke starte:", (err as Error).message);
    return null;
  }
}

export interface PurchaseOutcome {
  // betalt: the money is taken and the story is the buyer's to make.
  // venter: not approved in Vipps yet. avbrutt: nothing was paid.
  status: "betalt" | "venter" | "avbrutt" | "ukjent" | "feil";
  kind?: PurchaseKind;
  vippsSub?: string;
}

interface VippsPayment {
  state?: "CREATED" | "AUTHORIZED" | "ABORTED" | "EXPIRED" | "TERMINATED";
  aggregate?: { capturedAmount?: { value?: number } };
}

// Looks the payment up at Vipps and takes the money if it is approved. Safe
// to call any number of times, by anyone holding the reference.
export async function confirmPurchase(reference: string): Promise<PurchaseOutcome> {
  if (!/^mb-[0-9a-f]{32}$/.test(reference)) return { status: "ukjent" };
  const rows = await tableRequest<PurchaseRow>("GET", "kjop", `referanse=eq.${reference}`);
  if (!rows) return { status: "feil" };
  const row = rows[0];
  if (!row) return { status: "ukjent" };
  const who = { kind: row.type, vippsSub: row.vipps_sub };
  if (row.status !== "opprettet") return { status: row.status, ...who };
  try {
    const path = `/epayment/v1/payments/${reference}`;
    let payment = await vipps<VippsPayment>("GET", path);
    if (payment.state === "CREATED") return { status: "venter", ...who };
    if (payment.state !== "AUTHORIZED") {
      await tableRequest("PATCH", "kjop", `referanse=eq.${reference}&status=eq.opprettet`, {
        status: "avbrutt",
      });
      return { status: "avbrutt", ...who };
    }
    if ((payment.aggregate?.capturedAmount?.value ?? 0) < row.belop) {
      payment = await vipps<VippsPayment>(
        "POST",
        `${path}/capture`,
        { modificationAmount: { value: row.belop, currency: "NOK" } },
        reference
      );
    }
    if ((payment.aggregate?.capturedAmount?.value ?? 0) < row.belop) {
      throw new Error("Vipps bekreftet ikke at beløpet er trukket");
    }
    const paid = await tableRequest("PATCH", "kjop", `referanse=eq.${reference}`, {
      status: "betalt",
      betalt: new Date().toISOString(),
    });
    return paid ? { status: "betalt", ...who } : { status: "feil", ...who };
  } catch (err) {
    console.error(`Vipps-kjøp ${reference} kunne ikke bekreftes:`, (err as Error).message);
    return { status: "feil", ...who };
  }
}

// Spend one bought story of this kind. Returns its reference (so it can be
// given back if the story fails), or null when there is none.
export async function useBoughtStory(
  vippsSub: string,
  kind: PurchaseKind
): Promise<string | null> {
  if (!purchasesReady()) return null;
  const ref = await quotaRpc<string | null>("bruk_kjop", { p_sub: vippsSub, p_type: kind });
  return typeof ref === "string" && ref ? ref : null;
}

export async function giveBackBoughtStory(reference: string): Promise<void> {
  await tableRequest("PATCH", "kjop", `referanse=eq.${reference}`, { brukt: null });
}

// Bought stories not yet made.
export async function boughtStories(
  vippsSub: string
): Promise<{ historie: number; dinHistorie: number }> {
  const out = { historie: 0, dinHistorie: 0 };
  if (!purchasesReady()) return out;
  const rows = await tableRequest<{ type: string }>(
    "GET",
    "kjop",
    `vipps_sub=eq.${encodeURIComponent(vippsSub)}&status=eq.betalt&brukt=is.null&select=type`
  );
  for (const row of rows ?? []) {
    if (row.type === "historie") out.historie += 1;
    else if (row.type === "din-historie") out.dinHistorie += 1;
  }
  return out;
}

// ---- Prinsen ----------------------------------------------------------------

const WEEK_ORE = PRICE_PRINSEN_PER_WEEK_KR * 100;
// How long before a week runs out the next charge is ordered, and how many
// days Vipps keeps trying when the first attempt fails.
const ORDER_DAYS_AHEAD = 3;
const RETRY_DAYS = 3;

interface AgreementRow {
  avtale_id: string;
  referanse: string;
  vipps_sub: string;
  status: "venter" | "aktiv" | "stoppet" | "avsluttet";
  betalt_til: string | null;
  trekk_id: string | null;
  trekk_forfall: string | null;
}

const updateAgreement = (id: string, patch: Partial<AgreementRow>) =>
  tableRequest("PATCH", "avtaler", `avtale_id=eq.${encodeURIComponent(id)}`, {
    ...patch,
    oppdatert: new Date().toISOString(),
  });

export interface Subscription {
  // stoppet: cancelled, and Prinsen lasts until paidUntil.
  status: "aktiv" | "stoppet";
  // The day the next charge is due (aktiv) or Prinsen ends (stoppet).
  paidUntil: string;
}

async function currentAgreement(vippsSub: string): Promise<AgreementRow | null> {
  const rows = await tableRequest<AgreementRow>(
    "GET",
    "avtaler",
    `vipps_sub=eq.${encodeURIComponent(vippsSub)}&status=in.(aktiv,stoppet)&order=opprettet.desc&limit=1`
  );
  return rows?.[0] ?? null;
}

export async function subscriptionOf(vippsSub: string): Promise<Subscription | null> {
  if (!subscriptionReady()) return null;
  const row = await currentAgreement(vippsSub);
  return row && row.betalt_til && row.status !== "venter" && row.status !== "avsluttet"
    ? { status: row.status, paidUntil: row.betalt_til }
    : null;
}

// Sends the user to Vipps to approve the agreement. "har" when they already
// have a running one.
export async function startSubscription(
  vippsSub: string,
  origin: string
): Promise<{ url: string } | "har" | null> {
  const rows = await tableRequest<AgreementRow>(
    "GET",
    "avtaler",
    `vipps_sub=eq.${encodeURIComponent(vippsSub)}&status=eq.aktiv&limit=1`
  );
  if (!rows) return null;
  if (rows.length > 0) return "har";
  const reference = randomBytes(16).toString("hex");
  try {
    const agreement = await vipps<{ agreementId?: string; vippsConfirmationUrl?: string }>(
      "POST",
      "/recurring/v3/agreements",
      {
        pricing: { type: "LEGACY", amount: WEEK_ORE, currency: "NOK" },
        interval: { unit: "WEEK", count: 1 },
        initialCharge: {
          amount: WEEK_ORE,
          description: `${PLAN_NAMES.pro} – første uke`,
          transactionType: "DIRECT_CAPTURE",
        },
        merchantRedirectUrl: `${origin}/?avtale=${reference}`,
        merchantAgreementUrl: `${origin}/?side=plan`,
        productName: `Magiboka ${PLAN_NAMES.pro}`,
        productDescription: "Så mange historier dere vil. Ingen binding.",
      },
      reference
    );
    if (!agreement.agreementId || !agreement.vippsConfirmationUrl) {
      throw new Error("svaret mangler avtale-id eller adresse");
    }
    const saved = await tableRequest("POST", "avtaler", "", {
      avtale_id: agreement.agreementId,
      referanse: reference,
      vipps_sub: vippsSub,
    });
    return saved ? { url: agreement.vippsConfirmationUrl } : null;
  } catch (err) {
    console.error("Vipps-avtale kunne ikke starte:", (err as Error).message);
    return null;
  }
}

export interface SubscriptionOutcome {
  status: "aktiv" | "venter" | "avbrutt" | "ukjent" | "feil";
  vippsSub?: string;
}

interface VippsAgreement {
  status?: "PENDING" | "ACTIVE" | "STOPPED" | "EXPIRED";
}

// Back from Vipps: is the agreement approved (and the first week paid)?
export async function confirmSubscription(reference: string): Promise<SubscriptionOutcome> {
  if (!/^[0-9a-f]{32}$/.test(reference)) return { status: "ukjent" };
  const rows = await tableRequest<AgreementRow>("GET", "avtaler", `referanse=eq.${reference}`);
  if (!rows) return { status: "feil" };
  const row = rows[0];
  if (!row) return { status: "ukjent" };
  const who = { vippsSub: row.vipps_sub };
  if (row.status === "aktiv") return { status: "aktiv", ...who };
  if (row.status !== "venter") return { status: "avbrutt", ...who };
  try {
    const agreement = await vipps<VippsAgreement>(
      "GET",
      `/recurring/v3/agreements/${encodeURIComponent(row.avtale_id)}`
    );
    if (agreement.status === "PENDING") return { status: "venter", ...who };
    if (agreement.status !== "ACTIVE") {
      await updateAgreement(row.avtale_id, { status: "avsluttet" });
      return { status: "avbrutt", ...who };
    }
    const saved =
      (await updateAgreement(row.avtale_id, {
        status: "aktiv",
        betalt_til: addDays(today(), 7),
      })) && (await setPlan(row.vipps_sub, "pro"));
    return saved ? { status: "aktiv", ...who } : { status: "feil", ...who };
  } catch (err) {
    console.error(`Vipps-avtale ${row.avtale_id} kunne ikke bekreftes:`, (err as Error).message);
    return { status: "feil", ...who };
  }
}

const stopAtVipps = (agreementId: string) =>
  vipps(
    "PATCH",
    `/recurring/v3/agreements/${encodeURIComponent(agreementId)}`,
    { status: "STOPPED" },
    `stopp-${agreementId}`
  );

// Cancel: no more charges, and Prinsen lasts out the paid week. Returns the
// day it ends, or null when there was nothing to cancel or it failed.
export async function stopSubscription(vippsSub: string): Promise<string | null> {
  const row = await currentAgreement(vippsSub);
  if (!row || !row.betalt_til) return null;
  if (row.status === "stoppet") return row.betalt_til;
  try {
    await stopAtVipps(row.avtale_id);
  } catch (err) {
    console.error(`Vipps-avtale ${row.avtale_id} kunne ikke stoppes:`, (err as Error).message);
    return null;
  }
  const saved = await updateAgreement(row.avtale_id, {
    status: "stoppet",
    trekk_id: null,
    trekk_forfall: null,
  });
  return saved ? row.betalt_til : null;
}

// The agreement is over: back to the free plan.
async function endSubscription(row: AgreementRow): Promise<void> {
  if ((await getAccount(row.vipps_sub)).plan === "pro") {
    await setPlan(row.vipps_sub, "gratis");
  }
  await updateAgreement(row.avtale_id, { status: "avsluttet", trekk_id: null, trekk_forfall: null });
}

interface VippsCharge {
  status?: string;
}

// One agreement's daily round. Returns what was done, for the log.
async function tendAgreement(row: AgreementRow): Promise<string> {
  const paidUntil = row.betalt_til ?? today();
  if (row.status === "stoppet") {
    if (daysUntil(paidUntil) > 0) return "sagt opp, varer ut uka";
    await endSubscription(row);
    return "avsluttet";
  }

  const agreementPath = `/recurring/v3/agreements/${encodeURIComponent(row.avtale_id)}`;
  const agreement = await vipps<VippsAgreement>("GET", agreementPath);
  if (agreement.status !== "ACTIVE") {
    // Cancelled in the Vipps app.
    if (daysUntil(paidUntil) > 0) {
      await updateAgreement(row.avtale_id, { status: "stoppet", trekk_id: null, trekk_forfall: null });
      return "sagt opp i Vipps";
    }
    await endSubscription(row);
    return "avsluttet (sagt opp i Vipps)";
  }

  let nextDue = paidUntil;
  if (row.trekk_id) {
    const charge = await vipps<VippsCharge>(
      "GET",
      `${agreementPath}/charges/${encodeURIComponent(row.trekk_id)}`
    );
    if (charge.status === "CHARGED") {
      nextDue = addDays(row.trekk_forfall ?? paidUntil, 7);
      await updateAgreement(row.avtale_id, {
        betalt_til: nextDue,
        trekk_id: null,
        trekk_forfall: null,
      });
    } else if (charge.status === "FAILED" || charge.status === "CANCELLED") {
      // Vipps has given up on the charge: the subscription ends.
      await stopAtVipps(row.avtale_id).catch(() => undefined);
      await endSubscription(row);
      return `avsluttet (trekket ${charge.status})`;
    } else {
      return `venter på trekk (${charge.status})`;
    }
  }

  if (daysUntil(nextDue) > ORDER_DAYS_AHEAD) return "betalt";
  // Vipps wants a charge at least a day ahead; two, to be clear of midnight.
  const earliest = addDays(today(), 2);
  const due = nextDue > earliest ? nextDue : earliest;
  const charge = await vipps<{ chargeId?: string }>(
    "POST",
    `${agreementPath}/charges`,
    {
      amount: WEEK_ORE,
      transactionType: "DIRECT_CAPTURE",
      description: `${PLAN_NAMES.pro} – en uke`,
      due,
      retryDays: RETRY_DAYS,
    },
    `${row.avtale_id}-${due}`
  );
  if (!charge.chargeId) throw new Error("svaret mangler trekk-id");
  await updateAgreement(row.avtale_id, { trekk_id: charge.chargeId, trekk_forfall: due });
  return `trekk bestilt til ${due}`;
}

// The daily job (api/trekk.ts): orders next week's charges, records the
// ones that went through, ends what is cancelled or unpaid, and picks up
// purchases that were paid without the buyer coming back to the site.
export async function dailyRound(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const note = (what: string) => {
    counts[what] = (counts[what] ?? 0) + 1;
  };

  if (subscriptionReady()) {
    const agreements =
      (await tableRequest<AgreementRow>("GET", "avtaler", "status=in.(aktiv,stoppet)")) ?? [];
    for (const row of agreements) {
      try {
        note(`avtale: ${(await tendAgreement(row)).replace(/ til \d{4}-\d{2}-\d{2}$/, "")}`);
      } catch (err) {
        console.error(`Avtale ${row.avtale_id} feilet:`, (err as Error).message);
        note("avtale: feil");
      }
    }
  }

  if (purchasesReady()) {
    const since = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const until = new Date(Date.now() - 10 * 60_000).toISOString();
    const open =
      (await tableRequest<PurchaseRow>(
        "GET",
        "kjop",
        `status=eq.opprettet&opprettet=gte.${since}&opprettet=lte.${until}&select=referanse`
      )) ?? [];
    for (const row of open) {
      note(`kjøp: ${(await confirmPurchase(row.referanse)).status}`);
    }
  }
  return counts;
}
