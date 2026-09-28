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

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

function addDays(day: LocalDate, days: number): LocalDate {
  return day + days * DAY_MS;
}

function localDate(instant: Date, timeZone: string): LocalDate {
  const wallClock = instant.getTime() + zoneOffsetMs(instant, timeZone);
  return Math.floor(wallClock / DAY_MS) * DAY_MS;
}

function startOfLocalDay(day: LocalDate, timeZone: string): Date {
  // The offset at midnight can differ from the offset at the first guess when
  // the zone changes its offset near midnight, so the second pass corrects it.
  const firstGuess = day - zoneOffsetMs(new Date(day), timeZone);
  return new Date(day - zoneOffsetMs(new Date(firstGuess), timeZone));
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
