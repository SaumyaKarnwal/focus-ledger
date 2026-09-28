import { useCallback, useRef } from "react";
import { newRequestId } from "./requestId";

/**
 * Keeps one request_id per action until a response arrives (docs/api.md,
 * "Idempotency"). A second press after a failure sends the same key while the
 * content is the same, because the first request may have reached the server.
 */
export function useRequestId() {
  const pending = useRef<{ content: string; requestId: string }>(undefined);

  const requestIdFor = useCallback((content: unknown): string => {
    const key = JSON.stringify(content, (_, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value,
    );
    if (pending.current?.content !== key) {
      pending.current = { content: key, requestId: newRequestId() };
    }
    return pending.current.requestId;
  }, []);

  const done = useCallback(() => {
    pending.current = undefined;
  }, []);

  return { requestIdFor, done };
}
