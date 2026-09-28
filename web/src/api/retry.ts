import { Code, ConnectError } from "@connectrpc/connect";

export const RETRY_DELAYS_MS: readonly number[] = [500, 2000];

// Connect reports a failed fetch (the network is down) as Unknown. A retry is
// safe for every call: a create sends the same request_id, and an update sends
// an absolute value.
const RETRYABLE_CODES = new Set([
  Code.Unknown,
  Code.Unavailable,
  Code.DeadlineExceeded,
]);

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
