import type { NodePb } from "../gen/focusledger/v1/model_pb";
import { dayRange, isInRange, type TimeRange } from "../ledger/period";
import {
  type ByMode,
  cycleStart,
  isInbox,
  isLogged,
  LOGGED_MODES,
  type LoggedCycle,
  totalsOf,
} from "../ledger/rollup";
import { formatMinutes, MODE_NAMES } from "../today/todayModel";
import type { SplitPart } from "../ui/SplitRing";

/** A logged cycle and the node it is on (the Inbox node for an untagged cycle). */
export type PlacedCycle = { cycle: LoggedCycle; node: NodePb };

/** The logged cycles that start inside `span`. */
export function cyclesIn(
  nodes: readonly NodePb[],
  span: TimeRange,
): PlacedCycle[] {
  return nodes.flatMap((node) =>
    node.cycles
      .filter(isLogged)
      .filter((cycle) => isInRange(cycleStart(cycle), span))
      .map((cycle) => ({ cycle, node })),
  );
}

export function minutesOf(cycles: readonly PlacedCycle[]): number {
  return cycles.reduce((sum, placed) => sum + placed.cycle.minutes, 0);
}

/** The change beside the total: "+2h 10m", "−45m", or undefined with nothing to compare. */
export function changeLabel(now: number, before: number): string | undefined {
  if (before === 0) return undefined;
  const difference = now - before;
  if (difference === 0) return "±0m";
  return `${difference > 0 ? "+" : "−"}${formatMinutes(Math.abs(difference))}`;
}

export type ModeShare = {
  mode: (typeof LOGGED_MODES)[number];
  minutes: number;
  percent: number;
};

/** Kind of focus: the minutes and the share of each mode. */
export function kindOfFocus(cycles: readonly PlacedCycle[]): ModeShare[] {
  const totals = totalsOf(cycles.map((placed) => placed.cycle));
  return LOGGED_MODES.map((mode) => ({
    mode,
    minutes: totals.minutesByMode[mode],
    percent:
      totals.minutes === 0
        ? 0
        : Math.round((totals.minutesByMode[mode] / totals.minutes) * 100),
  }));
}

/** The ring shows this many tasks; smaller ones go together into "Other". */
const RING_SLICES = 6;

/**
 * Where it went: the time per top-level task, the Untagged (Inbox) time as one
 * more slice, largest first. Time on a subtask counts for its top-level task.
 */
export function whereItWent(
  nodes: readonly NodePb[],
  cycles: readonly PlacedCycle[],
): SplitPart[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const topOf = (node: NodePb): NodePb => {
    const parent =
      node.parentId === undefined ? undefined : byId.get(node.parentId);
    return parent ? topOf(parent) : node;
  };
  const groups = new Map<string, { name: string; cycles: LoggedCycle[] }>();
  cycles.forEach(({ cycle, node }) => {
    const top = isInbox(node) ? undefined : topOf(node);
    const key = top?.id ?? "";
    const group = groups.get(key) ?? {
      name: top?.name ?? "Untagged",
      cycles: [],
    };
    group.cycles.push(cycle);
    groups.set(key, group);
  });
  const parts = [...groups.values()]
    .map((group) => {
      const totals = totalsOf(group.cycles);
      return {
        name: group.name,
        minutes: totals.minutes,
        byMode: totals.minutesByMode,
      };
    })
    .sort(
      (left, right) =>
        right.minutes - left.minutes || left.name.localeCompare(right.name),
    );
  if (parts.length <= RING_SLICES) return parts;
  const rest = parts.slice(RING_SLICES - 1);
  return [
    ...parts.slice(0, RING_SLICES - 1),
    {
      name: `${rest.length} more`,
      minutes: rest.reduce((sum, part) => sum + part.minutes, 0),
      byMode: Object.fromEntries(
        LOGGED_MODES.map((mode) => [
          mode,
          rest.reduce((sum, part) => sum + part.byMode[mode], 0),
        ]),
      ) as ByMode<number>,
    },
  ];
}

/** Whole days of the range up to now, empty days included (README "Report rules" 1). */
export function daysUpToNow(
  range: TimeRange,
  now: Date,
  timeZone: string,
): number {
  const end = Math.min(range.end.getTime(), now.getTime());
  let days = 0;
  let start = range.start.getTime();
  while (start < end) {
    days += 1;
    start = dayRange(new Date(start), timeZone).end.getTime();
  }
  return Math.max(days, 1);
}

/**
 * When you focus: minutes per clock hour (0-23) for each mode. Each cycle is
 * spread over the hours it spans (README "Report rules" 1), then divided by
 * `days` for an average day.
 */
export function minutesByHour(
  cycles: readonly PlacedCycle[],
  timeZone: string,
  days: number,
): ByMode<number[]> {
  const hours = Object.fromEntries(
    LOGGED_MODES.map((mode) => [mode, Array.from({ length: 24 }, () => 0)]),
  ) as ByMode<number[]>;
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  });
  cycles.forEach(({ cycle }) => {
    const parts = clock.formatToParts(cycleStart(cycle));
    const value = (type: string) =>
      Number(parts.find((part) => part.type === type)?.value ?? 0);
    let hour = value("hour");
    let left = cycle.minutes;
    let room = 60 - value("minute");
    while (left > 0) {
      const here = Math.min(left, room);
      hours[cycle.mode][hour] += here / days;
      left -= here;
      hour = (hour + 1) % 24;
      room = 60;
    }
  });
  return hours;
}

/**
 * The line over the curves: the mode with the most time, and the hours where
 * it stays near its peak. "peaked" for one day, "peaks" for an average.
 */
export function peakLine(
  hours: ByMode<number[]>,
  averaged: boolean,
): string | undefined {
  const totalOf = (mode: (typeof LOGGED_MODES)[number]) =>
    hours[mode].reduce((sum, minutes) => sum + minutes, 0);
  const mode = [...LOGGED_MODES].sort(
    (left, right) => totalOf(right) - totalOf(left),
  )[0];
  const values = hours[mode];
  const peak = Math.max(...values);
  if (peak <= 0) return undefined;
  const top = values.indexOf(peak);
  const near = (hour: number) =>
    hour >= 0 && hour < 24 && values[hour] >= peak * 0.75;
  let first = top;
  while (near(first - 1)) first -= 1;
  let last = top;
  while (near(last + 1)) last += 1;
  const verb = averaged ? "peaks" : "peaked";
  return `${MODE_NAMES[mode]} ${verb} ${hourSpan(first, last + 1)}.`;
}

// "9 – 11am", "11am – 1pm", "9 – 10pm".
function hourSpan(from: number, to: number): string {
  const suffix = (hour: number) => (hour % 24 < 12 ? "am" : "pm");
  const twelve = (hour: number) => ((hour + 11) % 12) + 1;
  return suffix(from) === suffix(to)
    ? `${twelve(from)} – ${twelve(to)}${suffix(to)}`
    : `${twelve(from)}${suffix(from)} – ${twelve(to)}${suffix(to)}`;
}

export function minutesLabel(minutes: number): string {
  return minutes < 60
    ? `${Math.round(minutes)}m`
    : formatMinutes(Math.round(minutes));
}
