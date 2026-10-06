import type { CyclePb } from "../gen/focusledger/v1/model_pb";
import {
  localDateString,
  type TimeRange,
  zonedDateTimeToInstant,
} from "../ledger/period";
import {
  type ByMode,
  cycleStart,
  LOGGED_MODES,
  type LoggedMode,
} from "../ledger/rollup";
import type { EstimateRow } from "../tree/estimateModel";
import {
  INBOX_ID,
  isClosedOrUnderClosed,
  knownNodes,
  lastCycle,
  type TodayData,
} from "../today/todayModel";

export type Meridiem = "am" | "pm";

/** What Log writes: the task, the local day and start ("15:30"), and the cycles. */
export type LogDraft = {
  nodeId: string;
  day: string;
  start: string;
  time: ByMode<EstimateRow>;
};

const pad = (value: number) => String(value).padStart(2, "0");

/** The task Log time opens on from Tasks: the last one worked, or Not sure yet. */
export function defaultLogTask(data: TodayData): string {
  const nodeId = lastCycle(data)?.nodeId;
  if (nodeId === undefined) return INBOX_ID;
  const nodes = knownNodes(data);
  const node = nodes.find((listed) => listed.id === nodeId);
  return node && !isClosedOrUnderClosed(node, nodes) ? node.id : INBOX_ID;
}

/** "15:30" from "3:30" and "pm", or undefined while the entry is not a time. */
export function parseStartTime(
  text: string,
  meridiem: Meridiem | undefined,
): string | undefined {
  const match = /^(\d{1,2}):?(\d{2})$/.exec(text.trim());
  if (!match || meridiem === undefined) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 1 || hour > 12 || minute > 59) return undefined;
  return `${pad((hour % 12) + (meridiem === "pm" ? 12 : 0))}:${pad(minute)}`;
}

/** The minutes of every counted cycle together. */
export function totalMinutes(rows: ByMode<EstimateRow>): number {
  return LOGGED_MODES.reduce(
    (sum, mode) => sum + rows[mode].cycleMinutes * rows[mode].cycleCount,
    0,
  );
}

/** "3:30 pm" from "15:30". */
export function formatClock(time: string): string {
  const [hour, minute] = time.split(":").map(Number);
  return `${hour % 12 || 12}:${pad(minute)} ${hour < 12 ? "am" : "pm"}`;
}

/** The wall-clock end, "5:15 pm". Past midnight it shows only the time. */
export function endClock(start: string, minutes: number): string {
  const [hour, minute] = start.split(":").map(Number);
  const total = (hour * 60 + minute + minutes) % (24 * 60);
  return formatClock(`${pad(Math.floor(total / 60))}:${pad(total % 60)}`);
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** A "YYYY-MM-DD" date as UTC midnight, for date arithmetic. */
const dateMs = (date: string) => {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
};
const dateOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const DAY_MS = 24 * 60 * 60 * 1000;

/** "Mon 21 Sep" for "2026-09-21". */
export function dayLabel(day: string): string {
  const date = new Date(dateMs(day));
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()].slice(0, 3)}`;
}

/** "Today · 3:30 pm", "Yesterday", or "Mon 21 Sep · 9:00 am". */
export function whenLabel(
  day: string,
  time: string | undefined,
  now: Date,
  timeZone: string,
): string {
  const today = localDateString(now, timeZone);
  const name =
    day === today
      ? "Today"
      : day === dateOf(dateMs(today) - DAY_MS)
        ? "Yesterday"
        : dayLabel(day);
  return time === undefined ? name : `${name} · ${formatClock(time)}`;
}

export type CalendarDay = {
  date: string;
  day: number;
  isToday: boolean;
  isFuture: boolean;
  hasCycles: boolean;
};

/**
 * The days of a month ("YYYY-MM"), Monday first. Each leading undefined is an
 * empty cell before the first day.
 */
export function monthGrid(
  month: string,
  today: string,
  cycleDays: ReadonlySet<string>,
): (CalendarDay | undefined)[] {
  const first = dateMs(`${month}-01`);
  const firstDate = new Date(first);
  const days = new Date(
    Date.UTC(firstDate.getUTCFullYear(), firstDate.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const leading = (firstDate.getUTCDay() + 6) % 7;
  return [
    ...Array.from({ length: leading }, () => undefined),
    ...Array.from({ length: days }, (_, index) => {
      const date = dateOf(first + index * DAY_MS);
      return {
        date,
        day: index + 1,
        isToday: date === today,
        isFuture: date > today,
        hasCycles: cycleDays.has(date),
      };
    }),
  ];
}

/** "September 2026" for "2026-09". */
export function monthLabel(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return `${MONTHS[monthNumber - 1]} ${year}`;
}

/** The month before or after "2026-09", as "YYYY-MM". */
export function shiftMonth(month: string, step: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber - 1 + step, 1))
    .toISOString()
    .slice(0, 7);
}

/** The local days, "YYYY-MM-DD", on which these cycles started. */
export function cycleDaysOf(
  cycles: readonly CyclePb[],
  timeZone: string,
): Set<string> {
  return new Set(
    cycles
      .filter((cycle) => cycle.startedAt !== undefined)
      .map((cycle) => localDateString(cycleStart(cycle), timeZone)),
  );
}

/** One hand entry for CreateCycle: one counted cycle. */
export type LogEntry = {
  requestId: string;
  /** Undefined for Not sure yet: the cycle goes to Untagged. */
  nodeId?: string;
  mode: LoggedMode;
  minutes: number;
  startedAt: Date;
};

const MINUTE_MS = 60_000;

/** How many cycles Log writes: one entry per counted cycle. */
export function entryCount(time: ByMode<EstimateRow>): number {
  return LOGGED_MODES.reduce((sum, mode) => sum + time[mode].cycleCount, 0);
}

/**
 * Each counted cycle as one entry, back to back from the start, in the order
 * Deep Focus, Execution, Shallow. No two entries share a start time.
 */
export function logEntries(
  draft: LogDraft,
  timeZone: string,
  requestIds: readonly string[],
): LogEntry[] {
  const start = zonedDateTimeToInstant(draft.day, draft.start, timeZone);
  const cycles = LOGGED_MODES.flatMap((mode) =>
    Array.from({ length: draft.time[mode].cycleCount }, () => ({
      mode,
      minutes: draft.time[mode].cycleMinutes,
    })),
  );
  const offsets = cycles.reduce<number[]>(
    (sums, cycle, index) => [...sums, sums[index] + cycle.minutes],
    [0],
  );
  return cycles.map((cycle, index) => ({
    requestId: requestIds[index],
    nodeId: draft.nodeId === INBOX_ID ? undefined : draft.nodeId,
    mode: cycle.mode,
    minutes: cycle.minutes,
    startedAt: new Date(start.getTime() + offsets[index] * MINUTE_MS),
  }));
}

/** The span every entry covers together, from the first start to the last end. */
export function logSpan(entries: readonly LogEntry[]): TimeRange | undefined {
  const last = entries.at(-1);
  if (!last) return undefined;
  return {
    start: entries[0].startedAt,
    end: new Date(last.startedAt.getTime() + last.minutes * MINUTE_MS),
  };
}

/** The local days to read for an overlap: the day itself and one on each side. */
export function overlapRange(day: string, timeZone: string): TimeRange {
  const start = zonedDateTimeToInstant(day, "00:00", timeZone);
  return {
    start: new Date(start.getTime() - 24 * 60 * MINUTE_MS),
    end: new Date(start.getTime() + 48 * 60 * MINUTE_MS),
  };
}

/** The first cycle that runs at the same time as the span, if any. */
export function overlappingCycle(
  span: TimeRange,
  cycles: readonly CyclePb[],
): CyclePb | undefined {
  return cycles.find((cycle) => {
    if (cycle.startedAt === undefined) return false;
    const start = cycleStart(cycle).getTime();
    // A running cycle has no minutes yet: it counts for its planned length.
    const end = start + (cycle.minutes ?? cycle.plannedMinutes) * MINUTE_MS;
    return start < span.end.getTime() && span.start.getTime() < end;
  });
}
