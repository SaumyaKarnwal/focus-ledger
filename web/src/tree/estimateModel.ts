import type {
  EstimatePb,
  NodePb,
  SettingsPb,
} from "../gen/focusledger/v1/model_pb";
import { type ByMode, LOGGED_MODES, type LoggedMode } from "../ledger/rollup";
import { plannedMinutesFor } from "../today/todayModel";

export type EstimateRow = { cycleMinutes: number; cycleCount: number };

export const ESTIMATE_LENGTH = { min: 5, max: 480, step: 5 };
export const ESTIMATE_COUNT = { min: 0, max: 99, step: 1 };

/** The node's estimate per mode. A mode with no row starts at the settings length and 0 cycles. */
export function estimateRows(
  node: NodePb,
  settings: SettingsPb,
): ByMode<EstimateRow> {
  const rowFor = (mode: LoggedMode): EstimateRow => {
    const saved = node.estimates.find((estimate) => estimate.mode === mode);
    return saved
      ? { cycleMinutes: saved.cycleMinutes, cycleCount: saved.cycleCount }
      : { cycleMinutes: plannedMinutesFor(settings, mode), cycleCount: 0 };
  };
  return Object.fromEntries(
    LOGGED_MODES.map((mode) => [mode, rowFor(mode)]),
  ) as ByMode<EstimateRow>;
}

/** One estimate per mode, so that the save replaces all three rows. */
export function toEstimates(
  rows: ByMode<EstimateRow>,
): Pick<EstimatePb, "mode" | "cycleMinutes" | "cycleCount">[] {
  return LOGGED_MODES.map((mode) => ({ mode, ...rows[mode] }));
}

export function estimateSummary(rows: ByMode<EstimateRow>): {
  cycles: number;
  minutes: number;
} {
  return LOGGED_MODES.reduce(
    (summary, mode) => ({
      cycles: summary.cycles + rows[mode].cycleCount,
      minutes:
        summary.minutes + rows[mode].cycleCount * rows[mode].cycleMinutes,
    }),
    { cycles: 0, minutes: 0 },
  );
}

export function stepWithin(
  value: number,
  step: number,
  range: { min: number; max: number },
): number {
  return Math.min(range.max, Math.max(range.min, value + step));
}
