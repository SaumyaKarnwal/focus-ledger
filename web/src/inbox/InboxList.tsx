import { useState } from "react";
import type { CyclePb, NodePb } from "../gen/focusledger/v1/model_pb";
import { localDateString, localTimeString } from "../ledger/period";
import { cycleStart, type LoggedMode } from "../ledger/rollup";
import { modeKey } from "../modes/modes";
import { MODE_NAMES } from "../today/todayModel";

type Props = {
  cycles: readonly CyclePb[];
  /** The open nodes that a cycle can be filed to. */
  targets: readonly NodePb[];
  timeZone: string;
  busy: boolean;
  onFile: (cycle: CyclePb, nodeId: string) => void;
};

/** The Inbox cycles, newest first, each with a File to picker (FR-9). */
export function InboxList({ cycles, targets, timeZone, busy, onFile }: Props) {
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const newestFirst = [...cycles].sort(
    (left, right) => cycleStart(right).getTime() - cycleStart(left).getTime(),
  );

  if (newestFirst.length === 0) {
    return <p className="note">No unfiled cycles.</p>;
  }
  return (
    <ul className="cycle-list" aria-label="Unfiled cycles">
      {newestFirst.map((cycle) => {
        const start = cycleStart(cycle);
        const target = chosen[cycle.id] ?? targets[0]?.id ?? "";
        return (
          <li
            key={cycle.id}
            className="cycle-row"
            data-mode={modeKey(cycle.mode)}
            data-testid="inbox-row"
          >
            <span className="mode-bar" aria-hidden="true" />
            <span className="cycle-row-name">
              {MODE_NAMES[cycle.mode as LoggedMode]}
            </span>
            <span className="cycle-row-mode mono">
              {localDateString(start, timeZone)}
            </span>
            <span className="cycle-row-time">
              {localTimeString(start, timeZone)}
            </span>
            <span className="cycle-row-minutes">
              {cycle.minutes === undefined ? "running" : cycle.minutes}
            </span>
            <label>
              <span className="visually-hidden">File to</span>
              <select
                value={target}
                onChange={(event) =>
                  setChosen((current) => ({
                    ...current,
                    [cycle.id]: event.target.value,
                  }))
                }
              >
                {targets.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="button button-small"
              disabled={busy || target === ""}
              onClick={() => onFile(cycle, target)}
            >
              File
            </button>
          </li>
        );
      })}
    </ul>
  );
}
