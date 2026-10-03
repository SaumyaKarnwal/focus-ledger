import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { CyclePb, NodePb } from "../gen/focusledger/v1/model_pb";
import {
  formatShortDate,
  localDateString,
  localTimeString,
} from "../ledger/period";
import { cycleStart, isInbox, isLogged } from "../ledger/rollup";
import { buildTree, type TreeRow } from "../tree/treeModel";

export type TaskRow = Omit<TreeRow, "children"> & {
  depth: number;
  /** Logged minutes of the task and its subtree. */
  logged: number;
  /** Estimated minutes of the task and its subtree, or undefined with no estimate. */
  estimate?: number;
  /** The latest cycle start in the task and its subtree. */
  lastWorked?: Date;
  /** Completed, or under a completed task. */
  closed: boolean;
  children: TaskRow[];
};

/** The task tree for the Tasks page. Siblings sort by last worked, newest first. */
export function taskTree(nodes: readonly NodePb[]): TaskRow[] {
  const toTaskRow = (
    row: TreeRow,
    depth: number,
    parentClosed: boolean,
  ): TaskRow => {
    const closed = parentClosed || row.node.closed;
    const children = sortByLastWorked(
      row.children.map((child) => toTaskRow(child, depth + 1, closed)),
    );
    const estimate =
      ownEstimate(row.node) +
      children.reduce((sum, child) => sum + (child.estimate ?? 0), 0);
    return {
      ...row,
      depth,
      logged: row.rollUp.rolledUp.minutes,
      estimate: estimate > 0 ? estimate : undefined,
      lastWorked: latest([
        latestStart(row.node.cycles),
        ...children.map((child) => child.lastWorked),
      ]),
      closed,
      children,
    };
  };
  return sortByLastWorked(
    buildTree(nodes).map((row) => toTaskRow(row, 0, false)),
  );
}

/** The rows to draw, depth first, without the children of a collapsed row. */
export function visibleRows(
  rows: readonly TaskRow[],
  collapsed: ReadonlySet<string>,
): TaskRow[] {
  return rows.flatMap((row) => [
    row,
    ...(collapsed.has(row.node.id) ? [] : visibleRows(row.children, collapsed)),
  ]);
}

export function findRow(
  rows: readonly TaskRow[],
  nodeId: string | undefined,
): TaskRow | undefined {
  return visibleRows(rows, new Set()).find((row) => row.node.id === nodeId);
}

/** A task can move under an open task outside its own subtree, or to the top, but not where it is. */
export function canMoveUnder(
  rows: readonly TaskRow[],
  moving: TaskRow,
  parentId: string | undefined,
): boolean {
  if (moving.closed || moving.node.parentId === parentId) return false;
  if (parentId === undefined) return true;
  const target = findRow(rows, parentId);
  return (
    target !== undefined &&
    !target.closed &&
    !visibleRows([moving], new Set()).some((row) => row.node.id === parentId)
  );
}

export type Untagged = {
  /** The logged Inbox cycles, newest first. */
  cycles: CyclePb[];
  minutes: number;
  latest?: Date;
};

export function untagged(nodes: readonly NodePb[]): Untagged {
  const cycles = nodes
    .filter(isInbox)
    .flatMap((node) => node.cycles)
    .filter(isLogged)
    .sort(
      (left, right) => cycleStart(right).getTime() - cycleStart(left).getTime(),
    );
  return {
    cycles,
    minutes: cycles.reduce((sum, cycle) => sum + (cycle.minutes ?? 0), 0),
    latest: cycles[0] && cycleStart(cycles[0]),
  };
}

/** "just now", "12 m ago", "2 h ago" today, then "yesterday", "4 d ago", and "6 w ago". */
export function formatAgo(instant: Date, now: Date, timeZone: string): string {
  const minutes = Math.floor((now.getTime() - instant.getTime()) / 60_000);
  const days = calendarDaysBetween(instant, now, timeZone);
  if (days <= 0) {
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} m ago`;
    return `${Math.floor(minutes / 60)} h ago`;
  }
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} d ago`;
  return `${Math.floor(days / 7)} w ago`;
}

/** "Today 14:20", "Yesterday 17:30", or "2 Sep 09:40". */
export function formatWhen(instant: Date, now: Date, timeZone: string): string {
  const time = localTimeString(instant, timeZone);
  const day = localDateString(instant, timeZone);
  if (day === localDateString(now, timeZone)) return `Today ${time}`;
  const yesterday = new Date(now.getTime() - 24 * 60 * 60_000);
  if (day === localDateString(yesterday, timeZone)) return `Yesterday ${time}`;
  return `${formatShortDate(instant, timeZone)} ${time}`;
}

/** The Untagged row's last worked: the time today, else how long ago. */
export function formatUntaggedLatest(
  instant: Date,
  now: Date,
  timeZone: string,
): string {
  return localDateString(instant, timeZone) === localDateString(now, timeZone)
    ? localTimeString(instant, timeZone)
    : formatAgo(instant, now, timeZone);
}

function calendarDaysBetween(
  earlier: Date,
  later: Date,
  timeZone: string,
): number {
  const dayMs = (instant: Date) =>
    Date.parse(`${localDateString(instant, timeZone)}T00:00:00Z`);
  return Math.round((dayMs(later) - dayMs(earlier)) / (24 * 60 * 60_000));
}

function ownEstimate(node: NodePb): number {
  return node.estimates.reduce(
    (sum, estimate) => sum + estimate.cycleMinutes * estimate.cycleCount,
    0,
  );
}

function latestStart(cycles: readonly CyclePb[]): Date | undefined {
  return latest(cycles.map(cycleStart));
}

function latest(dates: readonly (Date | undefined)[]): Date | undefined {
  return dates.reduce<Date | undefined>(
    (found, date) =>
      date !== undefined && (found === undefined || date > found)
        ? date
        : found,
    undefined,
  );
}

/** Newest last worked first. A task with no cycle goes after, in creation order. */
function sortByLastWorked(rows: TaskRow[]): TaskRow[] {
  const createdMs = (row: TaskRow) =>
    row.node.createdAt ? timestampDate(row.node.createdAt).getTime() : 0;
  return [...rows].sort((left, right) => {
    if (left.lastWorked && right.lastWorked) {
      return right.lastWorked.getTime() - left.lastWorked.getTime();
    }
    if (left.lastWorked) return -1;
    if (right.lastWorked) return 1;
    return createdMs(left) - createdMs(right);
  });
}
