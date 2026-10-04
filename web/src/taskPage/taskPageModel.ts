import type { CyclePb } from "../gen/focusledger/v1/model_pb";
import { dayRange, isInRange, type TimeRange } from "../ledger/period";
import {
  type ByMode,
  cycleStart,
  isLogged,
  LOGGED_MODES,
  type LoggedMode,
} from "../ledger/rollup";
import { MODE_NAMES } from "../today/todayModel";
import type { TaskRow } from "../tasks/tasksModel";
import type { SplitPart } from "../ui/SplitRing";

const RING_PARTS = 5;

export type ModeFigure = { logged: number; estimate: number };

export type EstimateFigures = {
  logged: number;
  estimate: number;
  byMode: ByMode<ModeFigure>;
  /** The estimate on the parts below, not on the task itself. */
  onParts: number;
};

/** Logged and estimated minutes of the task and its subtree, per mode. */
export function estimateFigures(row: TaskRow): EstimateFigures {
  const estimateByMode = subtreeEstimateByMode(row);
  const loggedByMode = row.rollUp.rolledUp.minutesByMode;
  const byMode = byModeOf((mode) => ({
    logged: loggedByMode[mode],
    estimate: estimateByMode[mode],
  }));
  const estimate = sumModes((mode) => estimateByMode[mode]);
  return {
    logged: row.rollUp.rolledUp.minutes,
    estimate,
    byMode,
    onParts: estimate - ownEstimate(row),
  };
}

export type RingPart = SplitPart;

/**
 * The ring: the leaf tasks under the task, largest first, five at most. Time
 * on the task itself, on the tasks between, and on the smaller leaves goes to
 * "Others". A task with no children splits by mode.
 */
export function ringParts(row: TaskRow): RingPart[] {
  if (row.children.length === 0) {
    const own = row.rollUp.own.minutesByMode;
    return LOGGED_MODES.filter((mode) => own[mode] > 0).map((mode) => ({
      name: MODE_NAMES[mode],
      minutes: own[mode],
      byMode: byModeOf((other) => (other === mode ? own[mode] : 0)),
      mode,
    }));
  }
  const leaves = leavesOf(row)
    .map((leaf) => ({
      name: leaf.node.name,
      minutes: leaf.rollUp.own.minutes,
      byMode: leaf.rollUp.own.minutesByMode,
    }))
    .filter((part) => part.minutes > 0)
    .sort((left, right) => right.minutes - left.minutes);
  const shown = leaves.slice(0, RING_PARTS);
  const rest = row.rollUp.rolledUp.minutes - sumParts(shown);
  const restByMode = byModeOf(
    (mode) =>
      row.rollUp.rolledUp.minutesByMode[mode] -
      shown.reduce((sum, part) => sum + part.byMode[mode], 0),
  );
  const others =
    rest > 0 ? [{ name: "Others", minutes: rest, byMode: restByMode }] : [];
  return [...shown, ...others].sort(
    (left, right) => right.minutes - left.minutes,
  );
}

export type DayBar = {
  range: TimeRange;
  isToday: boolean;
  byMode: ByMode<number>;
  total: number;
};

/** The seven days that end today, oldest first, with the subtree's logged minutes per mode. */
export function lastSevenDays(
  row: TaskRow,
  now: Date,
  timeZone: string,
): DayBar[] {
  const cycles = subtreeCycles(row).filter(isLogged);
  // Six steps back from today. A step goes through the day start, so a DST day stays one day.
  const days = Array.from({ length: 6 }).reduce<TimeRange[]>(
    (found) => [
      dayRange(new Date(found[0].start.getTime() - 1), timeZone),
      ...found,
    ],
    [dayRange(now, timeZone)],
  );
  return days.map((range, index) => {
    const inDay = cycles.filter((cycle) => isInRange(cycleStart(cycle), range));
    const byMode = byModeOf((mode) =>
      inDay
        .filter((cycle) => cycle.mode === mode)
        .reduce((sum, cycle) => sum + (cycle.minutes ?? 0), 0),
    );
    return {
      range,
      isToday: index === days.length - 1,
      byMode,
      total: sumModes((mode) => byMode[mode]),
    };
  });
}

/** The whole hours on the chart's scale: at least one, and one above the tallest bar. */
export function chartHours(days: readonly DayBar[]): number {
  const tallest = Math.max(0, ...days.map((day) => day.total));
  return Math.max(1, Math.floor(tallest / 60) + 1);
}

function leavesOf(row: TaskRow): TaskRow[] {
  return row.children.flatMap((child) =>
    child.children.length === 0 ? [child] : leavesOf(child),
  );
}

function subtreeCycles(row: TaskRow): CyclePb[] {
  return [
    ...row.node.cycles,
    ...row.children.flatMap((child) => subtreeCycles(child)),
  ];
}

function subtreeEstimateByMode(row: TaskRow): ByMode<number> {
  const own = byModeOf((mode) =>
    row.node.estimates
      .filter((estimate) => estimate.mode === mode)
      .reduce(
        (sum, estimate) => sum + estimate.cycleMinutes * estimate.cycleCount,
        0,
      ),
  );
  return row.children
    .map(subtreeEstimateByMode)
    .reduce((sum, child) => byModeOf((mode) => sum[mode] + child[mode]), own);
}

function ownEstimate(row: TaskRow): number {
  return row.node.estimates.reduce(
    (sum, estimate) => sum + estimate.cycleMinutes * estimate.cycleCount,
    0,
  );
}

function sumParts(parts: readonly { minutes: number }[]): number {
  return parts.reduce((sum, part) => sum + part.minutes, 0);
}

function sumModes(value: (mode: LoggedMode) => number): number {
  return LOGGED_MODES.reduce((sum, mode) => sum + value(mode), 0);
}

function byModeOf<T>(value: (mode: LoggedMode) => T): ByMode<T> {
  return Object.fromEntries(
    LOGGED_MODES.map((mode) => [mode, value(mode)]),
  ) as ByMode<T>;
}
