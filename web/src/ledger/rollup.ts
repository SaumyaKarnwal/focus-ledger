import { timestampDate } from "@bufbuild/protobuf/wkt";
import {
  type CyclePb,
  FocusMode,
  type NodePb,
} from "../gen/focusledger/v1/model_pb";
import { isInRange, type TimeRange } from "./period";

export type LoggedMode =
  FocusMode.DEEP_FOCUS | FocusMode.EXECUTION | FocusMode.SHALLOW;

export const LOGGED_MODES: readonly LoggedMode[] = [
  FocusMode.DEEP_FOCUS,
  FocusMode.EXECUTION,
  FocusMode.SHALLOW,
];

export type ByMode<T> = Record<LoggedMode, T>;

export type Totals = { minutes: number; minutesByMode: ByMode<number> };

export type Figures = Totals & { doneCycles: number; estimatedCycles: number };

export type NodeRollUp = { own: Figures; rolledUp: Figures };

export type CycleCounts = { doneCycles: number; estimatedCycles: number };

export type EstimateProgress = CycleCounts & { byMode: ByMode<CycleCounts> };

export type PlannedVsActual = {
  doneCycles: number;
  plannedMinutes: number;
  minutes: number;
};

/** A cycle that has minutes. */
export type LoggedCycle = CyclePb & { minutes: number; mode: LoggedMode };

export function isInbox(node: NodePb): boolean {
  return node.id === "";
}

export function isLogged(cycle: CyclePb): cycle is LoggedCycle {
  return cycle.minutes !== undefined && isLoggedMode(cycle.mode);
}

export function cycleStart(cycle: CyclePb): Date {
  return cycle.startedAt ? timestampDate(cycle.startedAt) : new Date(0);
}

/** The cycle with no minutes. The server allows at most one. */
export function runningCycle(nodes: readonly NodePb[]): CyclePb | undefined {
  return nodes
    .flatMap((node) => node.cycles)
    .find((cycle) => cycle.minutes === undefined);
}

export function totalsOf(cycles: readonly CyclePb[]): Totals {
  return cycles.filter(isLogged).reduce(
    (totals, cycle) => {
      totals.minutes += cycle.minutes;
      totals.minutesByMode[cycle.mode] += cycle.minutes;
      return totals;
    },
    { minutes: 0, minutesByMode: byMode(() => 0) },
  );
}

/** All logged cycles, including the Inbox and closed nodes. */
export function overallTotals(nodes: readonly NodePb[]): Totals {
  return totalsOf(nodes.flatMap((node) => node.cycles));
}

/** Logged cycles that started in `range`, such as today or this week. */
export function periodTotals(
  nodes: readonly NodePb[],
  range: TimeRange,
): Totals {
  return totalsOf(
    nodes
      .flatMap((node) => node.cycles)
      .filter((cycle) => isInRange(cycleStart(cycle), range)),
  );
}

export function inboxTotals(nodes: readonly NodePb[]): Totals & {
  doneCycles: number;
} {
  const cycles = nodes.filter(isInbox).flatMap((node) => node.cycles);
  return {
    ...totalsOf(cycles),
    doneCycles: cycles.filter(isLogged).length,
  };
}

/**
 * The own and the rolled-up figures of every node that is reachable from a
 * root, keyed by node ID. A node whose parent is not in `nodes` has no row.
 */
export function rollUpTree(nodes: readonly NodePb[]): Map<string, NodeRollUp> {
  const treeNodes = nodes.filter((node) => !isInbox(node));
  const isRoot = (node: NodePb) => node.parentId === undefined;
  const childrenByParent = treeNodes
    .filter((node) => !isRoot(node))
    .reduce((groups, node) => {
      const parentId = node.parentId as string;
      groups.set(parentId, [...(groups.get(parentId) ?? []), node]);
      return groups;
    }, new Map<string, NodePb[]>());

  const rollUps = new Map<string, NodeRollUp>();
  const rollUp = (node: NodePb): NodeRollUp => {
    const own = ownFigures(node);
    const rolledUp = (childrenByParent.get(node.id) ?? [])
      .map((child) => rollUp(child).rolledUp)
      .reduce(addFigures, own);
    const result = { own, rolledUp };
    rollUps.set(node.id, result);
    return result;
  };
  treeNodes.filter(isRoot).forEach(rollUp);
  return rollUps;
}

/** A node's own logged cycles against its own estimate, such as "3 of 8". */
export function estimateProgress(node: NodePb): EstimateProgress {
  const logged = node.cycles.filter(isLogged);
  const counts = byMode<CycleCounts>((mode) => ({
    doneCycles: logged.filter((cycle) => cycle.mode === mode).length,
    estimatedCycles: node.estimates
      .filter((estimate) => estimate.mode === mode)
      .reduce((sum, estimate) => sum + estimate.cycleCount, 0),
  }));
  return {
    doneCycles: sumOver(counts, (count) => count.doneCycles),
    estimatedCycles: sumOver(counts, (count) => count.estimatedCycles),
    byMode: counts,
  };
}

/** Planned minutes against logged minutes per mode, over all logged cycles. */
export function plannedVsActual(
  nodes: readonly NodePb[],
): ByMode<PlannedVsActual> {
  const logged = nodes.flatMap((node) => node.cycles).filter(isLogged);
  return byMode((mode) =>
    logged
      .filter((cycle) => cycle.mode === mode)
      .reduce(
        (sum, cycle) => ({
          doneCycles: sum.doneCycles + 1,
          plannedMinutes: sum.plannedMinutes + cycle.plannedMinutes,
          minutes: sum.minutes + cycle.minutes,
        }),
        { doneCycles: 0, plannedMinutes: 0, minutes: 0 },
      ),
  );
}

function ownFigures(node: NodePb): Figures {
  const progress = estimateProgress(node);
  return {
    ...totalsOf(node.cycles),
    doneCycles: progress.doneCycles,
    estimatedCycles: progress.estimatedCycles,
  };
}

function addFigures(left: Figures, right: Figures): Figures {
  return {
    minutes: left.minutes + right.minutes,
    minutesByMode: byMode(
      (mode) => left.minutesByMode[mode] + right.minutesByMode[mode],
    ),
    doneCycles: left.doneCycles + right.doneCycles,
    estimatedCycles: left.estimatedCycles + right.estimatedCycles,
  };
}

function isLoggedMode(mode: FocusMode): mode is LoggedMode {
  return (LOGGED_MODES as readonly FocusMode[]).includes(mode);
}

function byMode<T>(valueFor: (mode: LoggedMode) => T): ByMode<T> {
  return {
    [FocusMode.DEEP_FOCUS]: valueFor(FocusMode.DEEP_FOCUS),
    [FocusMode.EXECUTION]: valueFor(FocusMode.EXECUTION),
    [FocusMode.SHALLOW]: valueFor(FocusMode.SHALLOW),
  };
}

function sumOver<T>(values: ByMode<T>, pick: (value: T) => number): number {
  return LOGGED_MODES.reduce((sum, mode) => sum + pick(values[mode]), 0);
}
