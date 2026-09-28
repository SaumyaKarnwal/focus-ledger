import type { NodePb } from "../gen/focusledger/v1/model_pb";
import {
  type ByMode,
  inboxTotals,
  LOGGED_MODES,
  overallTotals,
  type PlannedVsActual,
  plannedVsActual,
  type Totals,
} from "../ledger/rollup";
import { buildTree, type TreeRow } from "../tree/treeModel";

/** One row of the node × mode cross-tab. Its cells add up to its total. */
export type CrossTabRow = {
  nodeId: string;
  name: string;
  closed: boolean;
  depth: number;
  totals: Totals;
  children: CrossTabRow[];
};

export type EstimateRow = {
  nodeId: string;
  path: string[];
  name: string;
  estimatedCycles: number;
  doneCycles: number;
};

export type Report = {
  /** Root rows that have time in the period, children nested. */
  rows: CrossTabRow[];
  inbox: Totals;
  grand: Totals;
  loggedCycles: number;
  estimates: EstimateRow[];
  plannedVsActual: ByMode<PlannedVsActual>;
};

/** The report for the nodes of ListNodes(period, include_closed = true). */
export function buildReport(nodes: readonly NodePb[]): Report {
  const tree = buildTree(nodes);
  const toRow = (row: TreeRow, depth: number): CrossTabRow => ({
    nodeId: row.node.id,
    name: row.node.name,
    closed: row.node.closed,
    depth,
    totals: {
      minutes: row.rollUp.rolledUp.minutes,
      minutesByMode: row.rollUp.rolledUp.minutesByMode,
    },
    children: row.children
      .filter((child) => child.rollUp.rolledUp.minutes > 0)
      .map((child) => toRow(child, depth + 1)),
  });
  const flat = (rows: readonly TreeRow[]): TreeRow[] =>
    rows.flatMap((row) => [row, ...flat(row.children)]);
  const plannedByMode = plannedVsActual(nodes);

  return {
    rows: tree
      .filter((row) => row.rollUp.rolledUp.minutes > 0)
      .map((row) => toRow(row, 0)),
    inbox: inboxTotals(nodes),
    grand: overallTotals(nodes),
    loggedCycles: LOGGED_MODES.reduce(
      (sum, mode) => sum + plannedByMode[mode].doneCycles,
      0,
    ),
    estimates: flat(tree)
      .filter((row) => row.rollUp.own.estimatedCycles > 0)
      .map((row) => ({
        nodeId: row.node.id,
        path: row.path,
        name: row.node.name,
        estimatedCycles: row.rollUp.own.estimatedCycles,
        doneCycles: row.rollUp.own.doneCycles,
      })),
    plannedVsActual: plannedByMode,
  };
}

/** "+40%", "-25%", or "0%". Undefined when there is nothing to compare with. */
export function percentDifference(
  expected: number,
  actual: number,
): string | undefined {
  if (expected === 0) return undefined;
  const difference = Math.round(((actual - expected) / expected) * 100);
  return difference > 0 ? `+${difference}%` : `${difference}%`;
}

export function share(part: number, whole: number): string {
  return whole === 0 ? "0%" : `${Math.round((part / whole) * 100)}%`;
}
