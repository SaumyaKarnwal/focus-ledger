import { useState } from "react";
import type { LedgerClient } from "../api/ledgerClient";
import { withRetry } from "../api/retry";

import type { CyclePb } from "../gen/focusledger/v1/model_pb";
import { localDateString, localTimeString } from "../ledger/period";
import { cycleStart, isInbox, type LoggedMode } from "../ledger/rollup";
import { isClosedOrUnderClosed, MODE_NAMES } from "../today/todayModel";
import { useAction } from "../useAction";
import { useListNodes } from "../useListNodes";

type Props = {
  client: LedgerClient;
  timeZone: string;
  retryDelaysMs?: readonly number[];
};

export function InboxScreen({ client, timeZone, retryDelaysMs }: Props) {
  const { nodes, loadError, reload } = useListNodes(
    client,
    false,
    retryDelaysMs,
  );
  const { busy, error, run } = useAction();
  const [targets, setTargets] = useState<Record<string, string>>({});

  const all = nodes ?? [];
  const cycles = all
    .filter(isInbox)
    .flatMap((node) => node.cycles)
    .sort(
      (left, right) => cycleStart(right).getTime() - cycleStart(left).getTime(),
    );
  const openNodes = all.filter(
    (node) => !isInbox(node) && !isClosedOrUnderClosed(node, all),
  );

  // The Inbox is read again after a failure too, so a cycle that was filed
  // elsewhere leaves the list.
  const file = (cycle: CyclePb, nodeId: string) =>
    void run(async () => {
      try {
        await withRetry(
          () =>
            client.updateCycle({
              cycleId: cycle.id,
              nodeId,
              updateMask: { paths: ["node_id"] },
            }),
          retryDelaysMs,
        );
      } finally {
        reload();
      }
    });

  return (
    <section aria-labelledby="inbox-heading">
      <h2 id="inbox-heading">Inbox</h2>
      {(error ?? loadError) && <p role="alert">{error ?? loadError}</p>}
      {nodes === undefined && !loadError && <p>Loading…</p>}
      {nodes !== undefined && cycles.length === 0 && <p>No unfiled cycles.</p>}
      <ul aria-label="Unfiled cycles">
        {cycles.map((cycle) => {
          const start = cycleStart(cycle);
          const target = targets[cycle.id] ?? openNodes[0]?.id ?? "";
          return (
            <li key={cycle.id} data-testid="inbox-row">
              {localDateString(start, timeZone)}{" "}
              {localTimeString(start, timeZone)} ·{" "}
              {MODE_NAMES[cycle.mode as LoggedMode]} ·{" "}
              {cycle.minutes === undefined ? "running" : `${cycle.minutes} min`}{" "}
              <label>
                File to{" "}
                <select
                  value={target}
                  onChange={(event) =>
                    setTargets((current) => ({
                      ...current,
                      [cycle.id]: event.target.value,
                    }))
                  }
                >
                  {openNodes.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.name}
                    </option>
                  ))}
                </select>
              </label>{" "}
              <button
                type="button"
                disabled={busy || target === ""}
                onClick={() => file(cycle, target)}
              >
                File
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
