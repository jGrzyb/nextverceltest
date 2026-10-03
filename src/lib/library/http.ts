/**
 * fetch() with timeout and retry logic — the TypeScript equivalent of the
 * Python `requests` session configured with urllib3 retries.
 */

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export interface FetchRetryOptions {
  /** Number of retries after the initial attempt. */
  retries?: number;
  /** Base delay in milliseconds; doubles on every attempt (exponential backoff). */
  backoffFactorMs?: number;
  /** Per-attempt timeout in milliseconds. */
  timeoutMs?: number;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  options: FetchRetryOptions = {}
): Promise<Response> {
  const retries = options.retries ?? 3;
  const backoffFactorMs = options.backoffFactorMs ?? 1000;
  const timeoutMs = options.timeoutMs ?? 10_000;

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });

      // Return the response on success, on non-retryable statuses,
      // or when retries are exhausted (the caller decides what to do).
      if (
        response.ok ||
        !RETRYABLE_STATUS.has(response.status) ||
        attempt === retries
      ) {
        return response;
      }
      await sleep(backoffFactorMs * 2 ** attempt);
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await sleep(backoffFactorMs * 2 ** attempt);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
