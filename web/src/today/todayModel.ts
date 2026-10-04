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
  type ByMode,
  type CycleCounts,
  cycleStart,
  type EstimateProgress,
  LOGGED_MODES,
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
  /** The signed-in account, for the header badge. */
  email: string;
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
  /** The mode of each own logged cycle, oldest first, for the pips. */
  cycleModes: LoggedMode[];
  /** The last cycle start, or the creation time for a node with no cycles. */
  lastActivity: Date;
  worked: boolean;
};

export type SelectedNode = {
  nodeId: string;
  name: string;
  path: string[];
  node: NodePb;
  progress: EstimateProgress;
  /** Done and estimated cycles per mode, with the estimate's cycle length. */
  modeProgress: ByMode<CycleCounts & { cycleMinutes?: number }>;
  loggedToday: CyclePb[];
};

export type TodayModel = {
  rail: RailRow[];
  unfiledCycles: number;
  inbox: {
    cycles: CyclePb[];
    cycleModes: LoggedMode[];
    lastActivity: Date | undefined;
  };
  todayTotals: Totals;
  /** The mode of each cycle logged today, oldest first. */
  todayModes: LoggedMode[];
  weekTotals: Totals;
  allTimeCycles: number;
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
    .filter((node) => !isInbox(node) && !isClosedOrUnderClosed(node, nodes))
    .map((node) => railRow(node, nodes))
    .sort(
      (left, right) =>
        right.lastActivity.getTime() - left.lastActivity.getTime() ||
        left.name.localeCompare(right.name),
    );
  const inboxCycles = nodes.filter(isInbox).flatMap((node) => node.cycles);
  const today = dayRange(now, timeZone);
  return {
    rail,
    unfiledCycles: inboxTotals(nodes).doneCycles,
    inbox: {
      cycles: inboxCycles,
      cycleModes: loggedModes(inboxCycles),
      lastActivity: latestStart(inboxCycles),
    },
    todayTotals: periodTotals(data.weekNodes, today),
    todayModes: loggedModes(
      data.weekNodes
        .flatMap((node) => node.cycles)
        .filter((cycle) => isInRange(cycleStart(cycle), today)),
    ),
    weekTotals: periodTotals(data.weekNodes, data.week),
    allTimeCycles: nodes.flatMap((node) => node.cycles).filter(isLogged).length,
    running: runningCycle(knownNodes(data)),
  };
}

/** Where the next cycle stands against the node's estimate for the mode. */
export function nextCycleLine(
  counts: CycleCounts | undefined,
  inbox: boolean,
): string {
  if (inbox || !counts) return "Goes to the Inbox";
  if (counts.estimatedCycles === 0) return "No estimate for this mode";
  const next = counts.doneCycles + 1;
  if (next <= counts.estimatedCycles) {
    return `Cycle ${next} of ${counts.estimatedCycles}`;
  }
  return `The ${ordinal(next)} here — ${countWord(next - counts.estimatedCycles)} past the estimate`;
}

/** For example "Two of your three cycles today were deep." */
export function todaySentence(modes: readonly LoggedMode[]): string {
  if (modes.length === 0) return "Nothing logged yet today.";
  const counts = LOGGED_MODES.map((mode) => ({
    mode,
    count: modes.filter((logged) => logged === mode).length,
  })).sort((left, right) => right.count - left.count);
  const top = counts[0];
  const word = MODE_WORDS[top.mode];
  if (modes.length === 1) return `Your one cycle today was ${word}.`;
  if (top.count === modes.length) {
    return `All ${countWord(modes.length)} of your cycles today were ${word}.`;
  }
  const most = countWord(top.count);
  return `${most[0].toUpperCase()}${most.slice(1)} of your ${countWord(modes.length)} cycles today ${top.count === 1 ? "was" : "were"} ${word}.`;
}

const MODE_WORDS: Record<LoggedMode, string> = {
  [FocusMode.DEEP_FOCUS]: "deep",
  [FocusMode.EXECUTION]: "execution",
  [FocusMode.SHALLOW]: "shallow",
};

const COUNT_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];

function countWord(count: number): string {
  return COUNT_WORDS[count] ?? String(count);
}

function ordinal(count: number): string {
  const lastTwo = count % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${count}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[count % 10] ?? "th";
  return `${count}${suffix}`;
}

/** The mode of each logged cycle, oldest first. */
export function loggedModes(cycles: readonly CyclePb[]): LoggedMode[] {
  return cycles
    .filter(isLogged)
    .sort(
      (left, right) => cycleStart(left).getTime() - cycleStart(right).getTime(),
    )
    .map((cycle) => cycle.mode);
}

/** The node's own done and estimated cycles per mode, with the estimate's length. */
export function modeProgressOf(
  node: NodePb,
): ByMode<CycleCounts & { cycleMinutes?: number }> {
  const progress = estimateProgress(node);
  return Object.fromEntries(
    LOGGED_MODES.map((mode) => [
      mode,
      {
        ...progress.byMode[mode],
        cycleMinutes: node.estimates.find((estimate) => estimate.mode === mode)
          ?.cycleMinutes,
      },
    ]),
  ) as ByMode<CycleCounts & { cycleMinutes?: number }>;
}

function latestStart(cycles: readonly CyclePb[]): Date | undefined {
  const latest = cycles
    .map((cycle) => cycleStart(cycle).getTime())
    .reduce((max, time) => Math.max(max, time), -Infinity);
  return Number.isFinite(latest) ? new Date(latest) : undefined;
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
    node,
    progress: estimateProgress(node),
    modeProgress: modeProgressOf(node),
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
  /** The node's logged cycles in the cycle's mode, for the pips. */
  doneModes: LoggedMode[];
  estimated: number;
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
  const mode = cycle.mode as LoggedMode;
  if (!node) {
    return {
      nodeName: "Inbox",
      path: [],
      estimateLine: "Goes to the Inbox",
      doneModes: [],
      estimated: 0,
    };
  }
  const counts = estimateProgress(node).byMode[mode];
  const next = (counts?.doneCycles ?? 0) + 1;
  const estimated = counts?.estimatedCycles ?? 0;
  return {
    nodeName: node.name,
    path: pathOf(node, nodes),
    estimateLine:
      estimated === 0
        ? "No estimate for this mode"
        : next <= estimated
          ? `Cycle ${next} of ${estimated}`
          : `${ordinal(next)} cycle on a task estimated at ${estimated}`,
    doneModes: loggedModes(node.cycles).filter((logged) => logged === mode),
    estimated,
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
  return `${hours}h ${String(rest).padStart(2, "0")}m`;
}

/**
 * The task to show after the cycle: its own task, or undefined for the default
 * task when the cycle's task is now closed or under a closed task.
 */
export function taskAfterCycle(
  data: TodayData,
  cycle: CyclePb,
): string | undefined {
  if (cycle.nodeId === undefined) return INBOX_ID;
  const nodes = knownNodes(data);
  const node = nodes.find((listed) => listed.id === cycle.nodeId);
  return node && !isClosedOrUnderClosed(node, nodes) ? node.id : undefined;
}

/** The logged cycle that started last, on any task, or undefined for a new user. */
export function lastCycle(data: TodayData): CyclePb | undefined {
  return knownNodes(data)
    .flatMap((node) => node.cycles)
    .filter(isLogged)
    .reduce<CyclePb | undefined>(
      (latest, cycle) =>
        latest && cycleStart(latest) >= cycleStart(cycle) ? latest : cycle,
      undefined,
    );
}

/** ListNodes() also returns a closed node and its ancestors when a cycle runs on it. */
export function isClosedOrUnderClosed(
  node: NodePb,
  nodes: readonly NodePb[],
): boolean {
  const parent = nodes.find((listed) => listed.id === node.parentId);
  return (
    node.closed ||
    (parent !== undefined && isClosedOrUnderClosed(parent, nodes))
  );
}

function railRow(node: NodePb, nodes: readonly NodePb[]): RailRow {
  const lastStart = latestStart(node.cycles);
  return {
    nodeId: node.id,
    name: node.name,
    path: pathOf(node, nodes),
    progress: estimateProgress(node),
    cycleModes: loggedModes(node.cycles),
    lastActivity:
      lastStart ??
      (node.createdAt ? timestampDate(node.createdAt) : new Date(0)),
    worked: lastStart !== undefined,
  };
}
