// Retry transient Gemini failures (503 UNAVAILABLE, 429 RESOURCE_EXHAUSTED,
// 500 INTERNAL). Uses exponential backoff: 500ms, 1500ms, 3500ms.

const DELAYS_MS = [500, 1500, 3500];

function isTransient(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { status?: unknown; message?: unknown; error?: { code?: unknown; status?: unknown } };
  const code = typeof e.status === "number" ? e.status : e.error?.code;
  const statusText = typeof e.error?.status === "string" ? e.error.status : "";
  if (code === 503 || code === 429 || code === 500) return true;
  if (statusText === "UNAVAILABLE" || statusText === "RESOURCE_EXHAUSTED") return true;
  const msg = typeof e.message === "string" ? e.message : "";
  if (/UNAVAILABLE|high demand|try again later/i.test(msg)) return true;
  return false;
}

export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= DELAYS_MS.length; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === DELAYS_MS.length || !isTransient(error)) {
        throw error;
      }
      await new Promise((r) => setTimeout(r, DELAYS_MS[attempt]));
    }
  }
  throw lastError;
}
