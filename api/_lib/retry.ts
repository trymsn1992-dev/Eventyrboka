// Retry transient Gemini failures and hangs. Each attempt is bounded by a
// hard timeout so a stalled upstream call cannot pin the whole serverless
// function to its 300s cap.

const DELAYS_MS = [500, 1500];
const PER_ATTEMPT_TIMEOUT_MS = 20_000;

function isTransient(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { status?: unknown; message?: unknown; error?: { code?: unknown; status?: unknown } };
  const code = typeof e.status === "number" ? e.status : e.error?.code;
  const statusText = typeof e.error?.status === "string" ? e.error.status : "";
  if (code === 503 || code === 429 || code === 500) return true;
  if (statusText === "UNAVAILABLE" || statusText === "RESOURCE_EXHAUSTED") return true;
  const msg = typeof e.message === "string" ? e.message : "";
  if (/UNAVAILABLE|high demand|try again later|timeout|timed out/i.test(msg)) return true;
  // Empty-response errors from our own code — treat as transient so the model
  // fallback chain can try the next model (safety filter, routing weirdness).
  if (/tomt svar|empty response|no text|blocked/i.test(msg)) return true;
  return false;
}

function withTimeout<T>(fn: () => Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Gemini call timed out after ${ms}ms`)),
      ms
    );
    fn().then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= DELAYS_MS.length; attempt++) {
    try {
      return await withTimeout(fn, PER_ATTEMPT_TIMEOUT_MS);
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

// Tries each model in order. Each model gets its own full withRetry run.
// If a model exhausts retries with a transient error, we move to the next.
// Non-transient errors (e.g. invalid request) throw straight away.
export async function withModelFallback<T>(
  models: string[],
  fn: (model: string) => Promise<T>
): Promise<T> {
  let lastError: unknown;
  for (const model of models) {
    try {
      return await withRetry(() => fn(model));
    } catch (error) {
      lastError = error;
      if (!isTransient(error)) throw error;
      console.warn(
        `Model ${model} exhausted retries, falling back`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }
  throw lastError;
}
