import { create } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import {
  type CyclePb,
  FocusMode,
  type NodePb,
  NodePbSchema,
  type SettingsPb,
} from "../gen/focusledger/v1/model_pb";
import { dayRange, isInRange, type TimeRange } from "../ledger/period";
import {
  cycleStart,
  type EstimateProgress,
  estimateProgress,
  inboxTotals,
  isInbox,
  isLogged,
  type LoggedMode,
  periodTotals,
  runningCycle,
  type Totals,
} from "../ledger/rollup";

/** The rows that Today reads, from the calls in docs/api.md. */
export type TodayData = {
  settings: SettingsPb;
  /** ListNodes() for all time, open nodes only. */
  allTimeNodes: NodePb[];
  /** ListNodes(period = this week, include_closed = true). */
  weekNodes: NodePb[];
  week: TimeRange;
};

/** The ID of the Inbox in the rail. The Inbox node has no ID. */
export const INBOX_ID = "";

export type RailRow = {
  nodeId: string;
  name: string;
  path: string[];
  progress: EstimateProgress;
  /** The last cycle start, or the creation time for a node with no cycles. */
  lastActivity: Date;
  worked: boolean;
};

export type SelectedNode = {
  nodeId: string;
  name: string;
  path: string[];
  progress: EstimateProgress;
  loggedToday: CyclePb[];
};

export type TodayModel = {
  rail: RailRow[];
  unfiledCycles: number;
  todayTotals: Totals;
  weekTotals: Totals;
  running: CyclePb | undefined;
};

export const MODE_NAMES: Record<LoggedMode, string> = {
  [FocusMode.DEEP_FOCUS]: "Deep Focus",
  [FocusMode.EXECUTION]: "Execution",
  [FocusMode.SHALLOW]: "Shallow",
};

export function todayModel(
  data: TodayData,
  now: Date,
  timeZone: string,
): TodayModel {
  const nodes = data.allTimeNodes;
  const rail = nodes
    .filter((node) => !isInbox(node))
    .map((node) => railRow(node, nodes))
    .sort(
      (left, right) =>
        right.lastActivity.getTime() - left.lastActivity.getTime() ||
        left.name.localeCompare(right.name),
    );
  return {
    rail,
    unfiledCycles: inboxTotals(nodes).doneCycles,
    todayTotals: periodTotals(data.weekNodes, dayRange(now, timeZone)),
    weekTotals: periodTotals(data.weekNodes, data.week),
    running: runningCycle(knownNodes(data)),
  };
}

export function selectedNode(
  data: TodayData,
  nodeId: string,
  now: Date,
  timeZone: string,
): SelectedNode | undefined {
  const node =
    data.allTimeNodes.find((listed) => listed.id === nodeId) ??
    (nodeId === INBOX_ID ? create(NodePbSchema) : undefined);
  if (!node) return undefined;
  const today = dayRange(now, timeZone);
  return {
    nodeId: node.id,
    name: nodeName(node),
    path: pathOf(node, data.allTimeNodes),
    progress: estimateProgress(node),
    loggedToday: node.cycles
      .filter(isLogged)
      .filter((cycle) => isInRange(cycleStart(cycle), today)),
  };
}

export type CycleContext = {
  nodeName: string;
  path: string[];
  /** Where the running cycle stands against its node's estimate for its mode. */
  estimateLine: string;
};

/**
 * The open nodes from the all-time call, plus the closed nodes from the week
 * call. A closed node's cycles then cover this week only.
 */
export function knownNodes(data: TodayData): NodePb[] {
  const openIds = new Set(data.allTimeNodes.map((node) => node.id));
  return [
    ...data.allTimeNodes,
    ...data.weekNodes.filter((node) => !openIds.has(node.id)),
  ];
}

export function knownCycles(data: TodayData): CyclePb[] {
  return knownNodes(data).flatMap((node) => node.cycles);
}

export function cycleContext(data: TodayData, cycle: CyclePb): CycleContext {
  const nodes = knownNodes(data);
  const node = nodes.find(
    (listed) => !isInbox(listed) && listed.id === cycle.nodeId,
  );
  if (!node) {
    return { nodeName: "Inbox", path: [], estimateLine: "Goes to the Inbox" };
  }
  const counts = estimateProgress(node).byMode[cycle.mode as LoggedMode];
  return {
    nodeName: node.name,
    path: pathOf(node, nodes),
    estimateLine:
      counts && counts.estimatedCycles > 0
        ? `Cycle ${counts.doneCycles + 1} of ${counts.estimatedCycles}`
        : "No estimate for this mode",
  };
}

export function plannedMinutesFor(
  settings: SettingsPb,
  mode: LoggedMode,
): number {
  switch (mode) {
    case FocusMode.DEEP_FOCUS:
      return settings.deepFocusMinutes;
    case FocusMode.EXECUTION:
      return settings.executionMinutes;
    case FocusMode.SHALLOW:
      return settings.shallowMinutes;
  }
}

export function nodeName(node: NodePb): string {
  return isInbox(node) ? "Inbox" : node.name;
}

/** The names of the node's ancestors, from the root. */
export function pathOf(node: NodePb, nodes: readonly NodePb[]): string[] {
  const byId = new Map(nodes.map((listed) => [listed.id, listed]));
  const ancestors = (parentId: string | undefined): string[] => {
    const parent = parentId === undefined ? undefined : byId.get(parentId);
    return parent ? [...ancestors(parent.parentId), parent.name] : [];
  };
  return ancestors(node.parentId);
}

export function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

export function formatRelative(instant: Date, now: Date): string {
  const seconds = Math.round((instant.getTime() - now.getTime()) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  const format = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const [unit, size] = units.find(([, size]) => Math.abs(seconds) >= size) ?? [
    "second",
    1,
  ];
  return format.format(Math.round(seconds / size), unit);
}

function railRow(node: NodePb, nodes: readonly NodePb[]): RailRow {
  const lastStart = node.cycles
    .map((cycle) => cycleStart(cycle).getTime())
    .reduce((latest, time) => Math.max(latest, time), -Infinity);
  const worked = Number.isFinite(lastStart);
  return {
    nodeId: node.id,
    name: node.name,
    path: pathOf(node, nodes),
    progress: estimateProgress(node),
    lastActivity: worked
      ? new Date(lastStart)
      : node.createdAt
        ? timestampDate(node.createdAt)
        : new Date(0),
    worked,
  };
}
