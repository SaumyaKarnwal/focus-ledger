import { Code, ConnectError } from "@connectrpc/connect";

export const RETRY_DELAYS_MS: readonly number[] = [500, 2000];

const RETRYABLE_CODES = new Set([Code.Unavailable, Code.DeadlineExceeded]);

export function isRetryable(error: unknown): boolean {
  return RETRYABLE_CODES.has(ConnectError.from(error).code);
}

/**
 * Calls `call` again after a network failure. The caller builds the request
 * once, so every attempt sends the same `request_id`.
 */
export async function withRetry<T>(
  call: () => Promise<T>,
  delaysMs: readonly number[] = RETRY_DELAYS_MS,
): Promise<T> {
  try {
    return await call();
  } catch (error) {
    const [delayMs, ...laterDelays] = delaysMs;
    if (delayMs === undefined || !isRetryable(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return withRetry(call, laterDelays);
  }
}
