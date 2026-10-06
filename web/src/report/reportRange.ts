import {
  dateSpanRange,
  dayRange,
  monthRange,
  type TimeRange,
  weekRange,
} from "../ledger/period";

export type RangeKind = "today" | "week" | "month" | "custom";

/**
 * The range on the Report: a kind, and how many steps back from now (0 is the
 * range that holds now). Custom holds its own first and last local dates.
 */
export type RangeChoice = {
  kind: RangeKind;
  back: number;
  custom?: { from: string; to: string };
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** The range the choice names: ‹ › step by one range, or by Custom's span. */
export function rangeOf(
  choice: RangeChoice,
  now: Date,
  timeZone: string,
): TimeRange {
  if (choice.kind === "custom") {
    const span = customSpan(choice, now, timeZone);
    return stepBack(span, choice.back, (instant) => {
      const days = Math.round(
        (span.end.getTime() - span.start.getTime()) / DAY_MS,
      );
      const end = dayRange(instant, timeZone).end;
      return {
        start: dayRange(new Date(end.getTime() - days * DAY_MS + 1), timeZone)
          .start,
        end,
      };
    });
  }
  const unit = UNITS[choice.kind];
  return stepBack(unit(now, timeZone), choice.back, (instant) =>
    unit(instant, timeZone),
  );
}

const UNITS = {
  today: dayRange,
  week: weekRange,
  month: monthRange,
} as const;

function customSpan(
  choice: RangeChoice,
  now: Date,
  timeZone: string,
): TimeRange {
  const today = dayRange(now, timeZone);
  if (!choice.custom) return today;
  return dateSpanRange(choice.custom.from, choice.custom.to, timeZone);
}

// Each step takes the range that holds the instant just before the current one,
// so a step back is right across a time-zone change.
function stepBack(
  range: TimeRange,
  back: number,
  unit: (instant: Date) => TimeRange,
): TimeRange {
  return Array.from({ length: back }).reduce<TimeRange>(
    (current) => unit(new Date(current.start.getTime() - 1)),
    range,
  );
}

/** True while the range still runs: its end is after now. */
export function isRunning(range: TimeRange, now: Date): boolean {
  return range.start.getTime() <= now.getTime() && now < range.end;
}

/**
 * The two spans behind the total and its change (README "Report rules" 2). A
 * running range counts up to now, and the range before counts the same part.
 */
export function comparedSpans(
  choice: RangeChoice,
  now: Date,
  timeZone: string,
): { current: TimeRange; before: TimeRange } {
  const range = rangeOf(choice, now, timeZone);
  const previous = rangeOf({ ...choice, back: choice.back + 1 }, now, timeZone);
  if (!isRunning(range, now)) return { current: range, before: previous };
  const elapsed = now.getTime() - range.start.getTime();
  return {
    current: { start: range.start, end: now },
    before: {
      start: previous.start,
      end: new Date(
        Math.min(previous.end.getTime(), previous.start.getTime() + elapsed),
      ),
    },
  };
}

export type RangeTitle = { title: string; dates: string };

type DateParts = {
  weekday: string;
  day: string;
  month: string;
  year: string;
};

// The boards write "Tuesday, 22 September", "Sun 20 Sep", and "28 Sep – 4 Oct".
function dateParts(instant: Date, timeZone: string): DateParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).formatToParts(instant);
  const part = (type: string) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return {
    weekday: part("weekday"),
    day: part("day"),
    month: part("month"),
    year: part("year"),
  };
}

const short = (name: string) => name.slice(0, 3);

/**
 * The title and the dates under it (board R-Report-Range). The two nearest
 * steps have names; older ones are named by their dates.
 */
export function rangeTitle(
  choice: RangeChoice,
  now: Date,
  timeZone: string,
): RangeTitle {
  const range = rangeOf(choice, now, timeZone);
  const first = dateParts(range.start, timeZone);
  const last = dateParts(new Date(range.end.getTime() - 1), timeZone);
  const longDay = `${first.weekday}, ${first.day} ${first.month}`;
  const ago = (unit: string) => `${choice.back} ${unit}s ago`;

  switch (choice.kind) {
    case "today":
      if (choice.back === 0) return { title: "Today", dates: longDay };
      if (choice.back === 1) return { title: "Yesterday", dates: longDay };
      return {
        title: `${short(first.weekday)} ${first.day} ${short(first.month)}`,
        dates: ago("day"),
      };
    case "week": {
      const firstMonth =
        first.month === last.month ? "" : ` ${short(first.month)}`;
      const span = `${short(first.weekday)} ${first.day}${firstMonth} – ${short(last.weekday)} ${last.day} ${last.month}`;
      if (choice.back === 0)
        return { title: "This week", dates: `${span}, so far` };
      if (choice.back === 1) return { title: "Last week", dates: span };
      return { title: daySpan(first, last, short), dates: ago("week") };
    }
    case "month": {
      if (choice.back === 0) {
        const today = dateParts(now, timeZone);
        return {
          title: "This month",
          dates: `${daySpan(first, today, (name) => name)}, so far`,
        };
      }
      if (choice.back === 1)
        return {
          title: "Last month",
          dates: daySpan(first, last, (name) => name),
        };
      const thisYear = dateParts(now, timeZone).year;
      return {
        title:
          first.year === thisYear
            ? first.month
            : `${first.month} ${first.year}`,
        dates: ago("month"),
      };
    }
    case "custom": {
      const days = Math.round(
        (range.end.getTime() - range.start.getTime()) / DAY_MS,
      );
      return {
        title: daySpan(first, last, short),
        dates: days === 1 ? "1 day" : `${days} days`,
      };
    }
  }
}

// "1 – 22 September", or "28 Sep – 4 Oct" across a month.
function daySpan(
  first: DateParts,
  last: DateParts,
  month: (name: string) => string,
): string {
  if (first.month === last.month) {
    return `${first.day} – ${last.day} ${month(last.month)}`;
  }
  return `${first.day} ${month(first.month)} – ${last.day} ${month(last.month)}`;
}
