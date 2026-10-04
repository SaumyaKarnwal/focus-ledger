import type { NodePb } from "../gen/focusledger/v1/model_pb";
import { dayRange, localDateString, type TimeRange } from "../ledger/period";
import {
  type ByMode,
  cycleStart,
  isLogged,
  LOGGED_MODES,
  type LoggedMode,
} from "../ledger/rollup";
import type { PlacedCycle } from "./reportCards";

/** What you set, what you do (Report rules 4): average planned and actual minutes per mode. */
export type SetAndDo = {
  mode: LoggedMode;
  set: number;
  done: number;
  cycles: number;
};

export function setAndDo(cycles: readonly PlacedCycle[]): SetAndDo[] {
  return LOGGED_MODES.map((mode) => {
    const own = cycles.filter((placed) => placed.cycle.mode === mode);
    const average = (values: number[]) =>
      values.length === 0
        ? 0
        : Math.round(
            values.reduce((sum, value) => sum + value, 0) / values.length,
          );
    return {
      mode,
      set: average(own.map((placed) => placed.cycle.plannedMinutes)),
      done: average(own.map((placed) => placed.cycle.minutes)),
      cycles: own.length,
    };
  });
}

/**
 * Cycles you finished: a cycle ran to the bell when it logged at least its
 * planned length (an extension only adds time); otherwise it was stopped early.
 */
export function finishedCycles(
  cycles: readonly PlacedCycle[],
): ByMode<{ bell: number; stopped: number }> {
  return Object.fromEntries(
    LOGGED_MODES.map((mode) => {
      const own = cycles.filter((placed) => placed.cycle.mode === mode);
      const bell = own.filter(
        (placed) => placed.cycle.minutes >= placed.cycle.plannedMinutes,
      ).length;
      return [mode, { bell, stopped: own.length - bell }];
    }),
  ) as ByMode<{ bell: number; stopped: number }>;
}

export type DayBar = {
  label: string;
  minutes: number;
  current: boolean;
  future: boolean;
};

/** Minutes per local day of `range`, one bar per day. */
export function barsByDay(
  cycles: readonly PlacedCycle[],
  range: TimeRange,
  now: Date,
  timeZone: string,
  label: (day: Date) => string,
): DayBar[] {
  const days: TimeRange[] = [];
  let start = range.start;
  while (start < range.end) {
    const day = dayRange(start, timeZone);
    days.push(day);
    start = day.end;
  }
  return days.map((day) => ({
    label: label(day.start),
    minutes: minutesBetween(cycles, day),
    current: day.start <= now && now < day.end,
    future: day.start > now,
  }));
}

/** Minutes per Monday-to-Sunday week of a month, labelled "1 – 6", "7 – 13". */
export function barsByWeek(
  cycles: readonly PlacedCycle[],
  range: TimeRange,
  now: Date,
  timeZone: string,
): DayBar[] {
  const dayOfMonth = (instant: Date) =>
    Number(localDateString(instant, timeZone).slice(8));
  const weekday = (instant: Date) =>
    (new Date(localDateString(instant, timeZone)).getUTCDay() + 6) % 7;
  const weeks: TimeRange[] = [];
  let start = range.start;
  while (start < range.end) {
    let end = dayRange(start, timeZone).end;
    while (end < range.end && weekday(end) !== 0)
      end = dayRange(end, timeZone).end;
    weeks.push({ start, end });
    start = end;
  }
  return weeks
    .filter((week) => week.start <= now)
    .map((week) => {
      const last = new Date(
        Math.min(week.end.getTime(), dayRange(now, timeZone).end.getTime()) - 1,
      );
      return {
        label: `${dayOfMonth(week.start)} – ${dayOfMonth(last)}`,
        minutes: minutesBetween(cycles, week),
        current: week.start <= now && now < week.end,
        future: false,
      };
    });
}

function minutesBetween(
  cycles: readonly PlacedCycle[],
  span: TimeRange,
): number {
  return cycles
    .filter((placed) => {
      const start = cycleStart(placed.cycle);
      return start >= span.start && start < span.end;
    })
    .reduce((sum, placed) => sum + placed.cycle.minutes, 0);
}

export type YearDay = {
  date: string;
  minutes: number;
  level: 0 | 1 | 2 | 3 | 4;
};

export type Year = {
  /** Columns of seven days, Monday first; days outside the year are undefined. */
  weeks: (YearDay | undefined)[][];
  /** The month that starts in each column, or undefined. */
  months: (string | undefined)[];
  streak: number;
  best: number;
  daysWithFocus: number;
  since: string;
};

// Minutes in a day for each step of the heat map.
const LEVELS = [1, 30, 90, 180];

/**
 * Your year: the last twelve months to today, whatever the range above. The
 * streak counts days in a row with focus up to today (or up to yesterday while
 * today has none yet).
 */
export function yearOf(
  nodes: readonly NodePb[],
  now: Date,
  timeZone: string,
): Year {
  const minutesByDate = new Map<string, number>();
  nodes.forEach((node) =>
    node.cycles.filter(isLogged).forEach((cycle) => {
      const date = localDateString(cycleStart(cycle), timeZone);
      minutesByDate.set(date, (minutesByDate.get(date) ?? 0) + cycle.minutes);
    }),
  );
  const today = localDateString(now, timeZone);
  const first = yearStart(today);
  const dates: string[] = [];
  for (let date = first; date <= today; date = nextDate(date)) dates.push(date);
  const days = dates.map((date): YearDay => {
    const minutes = minutesByDate.get(date) ?? 0;
    const level = LEVELS.filter((threshold) => minutes >= threshold)
      .length as YearDay["level"];
    return { date, minutes, level };
  });

  const lead = weekdayOf(first);
  const cells: (YearDay | undefined)[] = [
    ...Array.from({ length: lead }, () => undefined),
    ...days,
  ];
  const weeks = Array.from(
    { length: Math.ceil(cells.length / 7) },
    (_, index) => cells.slice(index * 7, index * 7 + 7),
  );
  const monthName = (date: string) =>
    new Intl.DateTimeFormat("en-US", {
      month: "short",
      timeZone: "UTC",
    }).format(new Date(`${date}T12:00:00Z`));
  const months = weeks.map((week, index) => {
    const firstOfMonth = week.find((day) => day?.date.endsWith("-01"));
    if (firstOfMonth) return monthName(firstOfMonth.date);
    return index === 0 ? monthName(first) : undefined;
  });

  const runs = days.reduce<number[]>(
    (all, day) =>
      day.minutes > 0
        ? [...all.slice(0, -1), (all.at(-1) ?? 0) + 1]
        : [...all, 0],
    [0],
  );
  const lastDay = days.at(-1);
  const streak =
    lastDay && lastDay.minutes === 0 ? (runs.at(-2) ?? 0) : (runs.at(-1) ?? 0);
  return {
    weeks,
    months,
    streak,
    best: Math.max(...runs),
    daysWithFocus: days.filter((day) => day.minutes > 0).length,
    // "since last October", or "since January" when the year began the span.
    since: `${first.slice(0, 4) < today.slice(0, 4) ? "last " : ""}${new Intl.DateTimeFormat(
      "en-US",
      { month: "long", timeZone: "UTC" },
    ).format(new Date(`${first}T12:00:00Z`))}`,
  };
}

/** The span that Your year reads: the first day of the month a year ago, to the end of today. */
export function yearSpan(now: Date, timeZone: string): TimeRange {
  const first = yearStart(localDateString(now, timeZone));
  return {
    start: dayRange(new Date(`${first}T12:00:00Z`), timeZone).start,
    end: dayRange(now, timeZone).end,
  };
}

// The first day of the month eleven months back, so twelve month labels show.
function yearStart(today: string): string {
  const [year, month] = today.split("-").map(Number);
  const back = month - 11;
  const startYear = back <= 0 ? year - 1 : year;
  const startMonth = back <= 0 ? back + 12 : back;
  return `${startYear}-${String(startMonth).padStart(2, "0")}-01`;
}

function nextDate(date: string): string {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

function weekdayOf(date: string): number {
  return (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
}
