const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1000;

/** HTTP status codes / substrings that indicate a transient, retryable error. */
function isRetryableError(message: string): boolean {
  return (
    message.includes("429") ||
    message.includes("529") ||
    message.includes("rate") ||
    message.includes("timeout") ||
    message.includes("500") ||
    message.includes("502") ||
    message.includes("503")
  );
}

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  /** Injectable sleep for testing. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Runs `fn` with exponential backoff + jitter on transient failures. Used by
 * both the Cloudflare LLM binding and the local runtime so retry semantics are
 * identical everywhere.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  opts: RetryOptions = {}
): Promise<T> {
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (!isRetryableError(lastError.message) || attempt === maxRetries - 1) {
        break;
      }
      const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 500;
      await sleep(delay);
    }
  }

  throw new Error(
    `${label} failed after ${maxRetries} attempts: ${lastError?.message}`
  );
}
