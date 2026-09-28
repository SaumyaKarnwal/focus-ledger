import { create } from "@bufbuild/protobuf";
import { type FormEvent, useState } from "react";
import type { LedgerClient } from "../api/ledgerClient";
import { withRetry } from "../api/retry";
import { useRequestId } from "../api/useRequestId";
import {
  type CyclePb,
  FocusMode,
  NodePbSchema,
  type SettingsPb,
} from "../gen/focusledger/v1/model_pb";
import type { LoggedMode } from "../ledger/rollup";
import { ModeRows } from "../modes/ModeRows";
import {
  type EstimateRow,
  estimateRows,
  estimateSummary,
  toEstimates,
} from "../tree/estimateModel";
import type { ByMode } from "../ledger/rollup";
import { formatMinutes, MODE_NAMES } from "../today/todayModel";
import { PageHeader } from "../ui/PageHeader";
import { useAction } from "../useAction";

type Props = {
  client: LedgerClient;
  settings: SettingsPb;
  retryDelaysMs?: readonly number[];
  onStarted: (cycle: CyclePb) => void;
};

/** Execution at 50 × 1 is selected, the other modes at × 0 (FR-1.4). */
function firstRunRows(settings: SettingsPb): ByMode<EstimateRow> {
  const rows = estimateRows(create(NodePbSchema), settings);
  return {
    ...rows,
    [FocusMode.EXECUTION]: { ...rows[FocusMode.EXECUTION], cycleCount: 1 },
  };
}

/** The first screen: a name, the three mode rows, and one button (FR-1). */
export function FirstRunScreen({
  client,
  settings,
  retryDelaysMs,
  onStarted,
}: Props) {
  const [name, setName] = useState("");
  const [mode, setMode] = useState<LoggedMode>(FocusMode.EXECUTION);
  const [rows, setRows] = useState(() => firstRunRows(settings));
  const nodeKey = useRequestId();
  const cycleKey = useRequestId();
  const { busy, error, run } = useAction();
  const summary = estimateSummary(rows);
  const length = rows[mode].cycleMinutes;

  const start = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    const nodeContent = {
      name: trimmed,
      estimates: toEstimates(rows).filter((row) => row.cycleCount > 0),
    };
    void run(async () => {
      let nodeId: string | undefined;
      if (trimmed !== "") {
        const nodeRequest = {
          requestId: nodeKey.requestIdFor(nodeContent),
          ...nodeContent,
        };
        const { node } = await withRetry(
          () => client.createNode(nodeRequest),
          retryDelaysMs,
        );
        nodeId = node?.id;
      }
      const cycleContent = { nodeId, mode, plannedMinutes: length };
      const cycleRequest = {
        requestId: cycleKey.requestIdFor(cycleContent),
        ...cycleContent,
      };
      const { cycle } = await withRetry(
        () => client.createCycle(cycleRequest),
        retryDelaysMs,
      );
      nodeKey.done();
      cycleKey.done();
      if (cycle) onStarted(cycle);
    });
  };

  return (
    <>
      <PageHeader />
      <form className="first-run" onSubmit={start}>
        <div className="first-run-column">
          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          <label className="field">
            <span className="label">What are you working on?</span>
            <input
              className="first-run-name"
              type="text"
              placeholder="Name it, or leave it — it files itself either way"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <div className="field">
            <div className="section-head">
              <span className="label">How long do you think it will take?</span>
              <span className="label">length × cycles</span>
            </div>
            <ModeRows
              selected={mode}
              onSelect={setMode}
              groupName="first-run-mode"
              descriptions="long"
              estimate={{ rows, onChange: setRows }}
            />
            <div className="estimate-summary">
              <span className="note">
                A guess is enough. The report tells you how wrong it was, which
                is the point.
              </span>
              <span className="mono" aria-label="Estimate summary">
                {summary.cycles === 1 ? "1 cycle" : `${summary.cycles} cycles`}{" "}
                · {formatMinutes(summary.minutes)}
              </span>
            </div>
          </div>
          <button
            type="submit"
            className="button-primary first-run-start"
            disabled={busy}
          >
            Start the first cycle
            <span className="mono">
              {MODE_NAMES[mode]} · {length} min
            </span>
          </button>
          <p className="note">
            The highlighted row is the one that starts. Nothing here is
            required: leave the name blank and the cycle goes to the Inbox,
            leave every count at zero and the task has no estimate.
          </p>
        </div>
      </form>
    </>
  );
}
