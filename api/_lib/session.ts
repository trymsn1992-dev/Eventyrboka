// Signed cookie session. Server stores nothing — everything the client needs
// to prove who they are travels in the cookie, signed with SESSION_SECRET.
// Port of the Smertefri/Dempe `okt.js` approach, in TypeScript.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const now = () => Math.floor(Date.now() / 1000);

export const sessionSecretOk = () =>
  (process.env.SESSION_SECRET || "").length >= 32;

function secret(): string {
  if (!sessionSecretOk()) {
    throw new Error("SESSION_SECRET mangler eller er kortere enn 32 tegn");
  }
  return process.env.SESSION_SECRET as string;
}

// Purpose string ("session" vs "vipps") is part of the HMAC so a vipps-flow
// cookie can never be presented as a logged-in session or vice versa.
function sign(purpose: string, payload: string): Buffer {
  return createHmac("sha256", secret()).update(`${purpose}.${payload}`).digest();
}

export function sealCookie(
  purpose: string,
  data: Record<string, unknown>,
  lifetimeSec: number
): string {
  const payload = Buffer.from(
    JSON.stringify({ ...data, expires: now() + lifetimeSec })
  ).toString("base64url");
  return `${payload}.${sign(purpose, payload).toString("base64url")}`;
}

export function openCookie<T = Record<string, unknown>>(
  purpose: string,
  value: string | null | undefined
): (T & { expires: number }) | null {
  if (!value || !value.includes(".")) return null;
  const [payload, sig] = value.split(".");
  const expected = sign(purpose, payload);
  const got = Buffer.from(sig, "base64url");
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
    return null;
  }
  const data = JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8")
  ) as T & { expires: number };
  return data.expires && data.expires >= now() ? data : null;
}

// 32 random bytes → 43 chars, valid as a PKCE verifier.
export const randomToken = () => randomBytes(32).toString("base64url");
export const codeChallenge = (verifier: string) =>
  createHash("sha256").update(verifier).digest("base64url");

export function readCookie(req: VercelRequest, name: string): string | null {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function buildCookie(
  name: string,
  value: string,
  lifetimeSec: number
): string {
  return `${name}=${encodeURIComponent(
    value
  )}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${lifetimeSec}`;
}

// How long a login lasts. /api/meg renews the cookie on visits, so someone
// who keeps using the site stays signed in.
export const SESSION_LIFETIME_SEC = 180 * 24 * 60 * 60;

export const sessionCookie = (sub: string, fornavn: string): string =>
  buildCookie(
    "eventyrboka_okt",
    sealCookie("session", { sub, fornavn }, SESSION_LIFETIME_SEC),
    SESSION_LIFETIME_SEC
  );

export interface Session {
  sub: string;
  fornavn: string;
  expires: number;
}

export function readSession(req: VercelRequest): Session | null {
  let s: (Session & { expires: number }) | null = null;
  try {
    s = openCookie<Session>("session", readCookie(req, "eventyrboka_okt"));
  } catch {
    s = null;
  }
  if (!s || typeof s.sub !== "string" || !s.sub) return null;
  return s;
}

export function redirect(res: VercelResponse, path: string): void {
  res.statusCode = 302;
  res.setHeader("Location", path);
  res.setHeader("Cache-Control", "no-store");
  res.end();
}
