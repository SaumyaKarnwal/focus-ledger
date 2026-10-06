import { useCallback, useEffect, useState } from "react";
import type { Ledger } from "./api/ledger";
import { withRetry } from "./api/retry";
import type { NodePb } from "./gen/focusledger/v1/model_pb";

/** ListNodes for all time. `reload` reads it again after a write. */
export function useListNodes(
  client: Ledger,
  includeClosed: boolean,
  retryDelaysMs?: readonly number[],
) {
  const [nodes, setNodes] = useState<NodePb[]>();
  const [loadError, setLoadError] = useState<string>();
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    withRetry(() => client.listNodes({ includeClosed }), retryDelaysMs).then(
      (response) => {
        if (cancelled) return;
        setNodes(response.nodes);
        setLoadError(undefined);
      },
      (reason: unknown) => {
        if (!cancelled) setLoadError(String(reason));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, includeClosed, retryDelaysMs, version]);

  const reload = useCallback(() => setVersion((current) => current + 1), []);
  return { nodes, loadError, reload };
}
