import { useState } from "react";
import type { NodePb, SettingsPb } from "../gen/focusledger/v1/model_pb";
import { LOGGED_MODES, type LoggedMode } from "../ledger/rollup";
import { formatMinutes, MODE_NAMES } from "../today/todayModel";
import {
  ESTIMATE_COUNT,
  ESTIMATE_LENGTH,
  type EstimateRow,
  estimateRows,
  estimateSummary,
  stepWithin,
  toEstimates,
} from "./estimateModel";

type Props = {
  node: NodePb;
  settings: SettingsPb;
  busy: boolean;
  onSave: (estimates: ReturnType<typeof toEstimates>) => void;
  onCancel: () => void;
};

export function EstimateEditor({
  node,
  settings,
  busy,
  onSave,
  onCancel,
}: Props) {
  const [rows, setRows] = useState(() => estimateRows(node, settings));
  const summary = estimateSummary(rows);

  const change = (
    mode: LoggedMode,
    update: (row: EstimateRow) => EstimateRow,
  ) => setRows((current) => ({ ...current, [mode]: update(current[mode]) }));

  return (
    <fieldset aria-label={`Estimate for ${node.name}`}>
      <legend>Estimate</legend>
      {LOGGED_MODES.map((mode) => {
        const row = rows[mode];
        const name = MODE_NAMES[mode];
        return (
          <p key={mode} role="group" aria-label={name}>
            {name}{" "}
            <button
              type="button"
              aria-label={`Shorter ${name} cycles`}
              onClick={() =>
                change(mode, (current) => ({
                  ...current,
                  cycleMinutes: stepWithin(
                    current.cycleMinutes,
                    -ESTIMATE_LENGTH.step,
                    ESTIMATE_LENGTH,
                  ),
                }))
              }
            >
              −
            </button>{" "}
            <output aria-label={`${name} length`}>
              {row.cycleMinutes} min
            </output>{" "}
            <button
              type="button"
              aria-label={`Longer ${name} cycles`}
              onClick={() =>
                change(mode, (current) => ({
                  ...current,
                  cycleMinutes: stepWithin(
                    current.cycleMinutes,
                    ESTIMATE_LENGTH.step,
                    ESTIMATE_LENGTH,
                  ),
                }))
              }
            >
              +
            </button>{" "}
            ×{" "}
            <button
              type="button"
              aria-label={`Fewer ${name} cycles`}
              onClick={() =>
                change(mode, (current) => ({
                  ...current,
                  cycleCount: stepWithin(
                    current.cycleCount,
                    -ESTIMATE_COUNT.step,
                    ESTIMATE_COUNT,
                  ),
                }))
              }
            >
              −
            </button>{" "}
            <output aria-label={`${name} count`}>{row.cycleCount}</output>{" "}
            <button
              type="button"
              aria-label={`More ${name} cycles`}
              onClick={() =>
                change(mode, (current) => ({
                  ...current,
                  cycleCount: stepWithin(
                    current.cycleCount,
                    ESTIMATE_COUNT.step,
                    ESTIMATE_COUNT,
                  ),
                }))
              }
            >
              +
            </button>{" "}
            = {formatMinutes(row.cycleCount * row.cycleMinutes)}
          </p>
        );
      })}
      <p aria-label="Estimate summary">
        {summary.cycles} cycles · {formatMinutes(summary.minutes)}
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => onSave(toEstimates(rows))}
      >
        Save estimate
      </button>{" "}
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </fieldset>
  );
}
