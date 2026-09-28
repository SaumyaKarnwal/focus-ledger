import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { type PeriodPb, PeriodPbSchema } from "../gen/focusledger/v1/model_pb";

/** A time range [start, end). */
export type TimeRange = { start: Date; end: Date };

export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** The local day in `timeZone` that holds `instant`. */
export function dayRange(instant: Date, timeZone: string): TimeRange {
  const day = localDate(instant, timeZone);
  return {
    start: startOfLocalDay(day, timeZone),
    end: startOfLocalDay(addDays(day, 1), timeZone),
  };
}

/** The local week in `timeZone` that holds `instant`. A week starts on Monday. */
export function weekRange(instant: Date, timeZone: string): TimeRange {
  const day = localDate(instant, timeZone);
  const daysSinceMonday = (new Date(day).getUTCDay() + 6) % 7;
  const monday = addDays(day, -daysSinceMonday);
  return {
    start: startOfLocalDay(monday, timeZone),
    end: startOfLocalDay(addDays(monday, 7), timeZone),
  };
}

export function toPeriodPb(range: TimeRange): PeriodPb {
  return create(PeriodPbSchema, {
    start: timestampFromDate(range.start),
    end: timestampFromDate(range.end),
  });
}

export function isInRange(instant: Date, range: TimeRange): boolean {
  const time = instant.getTime();
  return time >= range.start.getTime() && time < range.end.getTime();
}

/** A calendar date as the UTC midnight of that date, in epoch milliseconds. */
type LocalDate = number;

const SECOND_MS = 1000;
const DAY_MS = 24 * 60 * 60 * SECOND_MS;

function addDays(day: LocalDate, days: number): LocalDate {
  return day + days * DAY_MS;
}

function localDate(instant: Date, timeZone: string): LocalDate {
  return Math.floor(wallClockMs(instant.getTime(), timeZone) / DAY_MS) * DAY_MS;
}

/** The first instant whose local date is `day`. */
function startOfLocalDay(day: LocalDate, timeZone: string): Date {
  const [earlier, later] = [addDays(day, -1), addDays(day, 1)]
    .map((nearby) => day - zoneOffsetMs(new Date(nearby), timeZone))
    .sort((left, right) => left - right);
  const midnight = [earlier, later].find(
    (candidate) => wallClockMs(candidate, timeZone) === day,
  );
  if (midnight !== undefined) return new Date(midnight);

  // The zone skips midnight on this day, so the day starts at the offset change.
  let before = earlier;
  let after = later;
  while (after - before > SECOND_MS) {
    const middle =
      before + Math.floor((after - before) / 2 / SECOND_MS) * SECOND_MS;
    if (wallClockMs(middle, timeZone) >= day) after = middle;
    else before = middle;
  }
  return new Date(after);
}

function wallClockMs(instantMs: number, timeZone: string): number {
  return instantMs + zoneOffsetMs(new Date(instantMs), timeZone);
}

function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    zoneFormatter(timeZone)
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  const wallClockAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  const instantToTheSecond = Math.floor(instant.getTime() / 1000) * 1000;
  return wallClockAsUtc - instantToTheSecond;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  formatters.set(timeZone, formatter);
  return formatter;
}
