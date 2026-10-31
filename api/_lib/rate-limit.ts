// Simple in-memory sliding window per IP. Lives per serverless instance,
// so it is not a hard global limit — it still blocks the trivially bad case
// (one tab hammering the API) without extra infrastructure. For a stronger
// limit, swap this for Upstash Ratelimit or similar.

type Entry = { count: number; resetAt: number };

const store = new Map<string, Entry>();

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 30;

export function rateLimit(ip: string): { ok: boolean; retryAfter?: number } {
  const now = Date.now();
  const entry = store.get(ip);

  if (!entry || entry.resetAt < now) {
    store.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return { ok: true };
  }

  if (entry.count >= MAX_REQUESTS_PER_WINDOW) {
    return { ok: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }

  entry.count += 1;
  return { ok: true };
}

export function getClientIp(req: {
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  if (Array.isArray(forwarded) && forwarded.length > 0) return forwarded[0];
  return req.socket?.remoteAddress || "unknown";
}
