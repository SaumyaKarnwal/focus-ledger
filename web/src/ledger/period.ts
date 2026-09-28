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

/** The local month in `timeZone` that holds `instant`. */
export function monthRange(instant: Date, timeZone: string): TimeRange {
  const [year, month] = localDateString(instant, timeZone)
    .split("-")
    .map(Number);
  const next = month === 12 ? [year + 1, 1] : [year, month + 1];
  return {
    start: localDayStart(`${year}-${pad2(month)}-01`, timeZone),
    end: localDayStart(`${next[0]}-${pad2(next[1])}-01`, timeZone),
  };
}

/** The week before the local week that holds `instant`. */
export function lastWeekRange(instant: Date, timeZone: string): TimeRange {
  return weekRange(
    new Date(weekRange(instant, timeZone).start.getTime() - 1),
    timeZone,
  );
}

/** From the start of local date `from` to the end of local date `to` ("YYYY-MM-DD"). */
export function dateSpanRange(
  from: string,
  to: string,
  timeZone: string,
): TimeRange {
  return {
    start: localDayStart(from, timeZone),
    end: dayRange(zonedDateTimeToInstant(to, "12:00", timeZone), timeZone).end,
  };
}

// Noon exists on every local date, also where the zone skips midnight.
function localDayStart(date: string, timeZone: string): Date {
  return dayRange(zonedDateTimeToInstant(date, "12:00", timeZone), timeZone)
    .start;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
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

/**
 * The instant of a local date ("2026-11-01") and time ("09:30") in `timeZone`.
 * A time that the zone skips moves forward by the gap. A time that occurs
 * twice gives the earlier instant.
 */
export function zonedDateTimeToInstant(
  date: string,
  time: string,
  timeZone: string,
): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wallClock = Date.UTC(year, month - 1, day, hour, minute);
  const offsetBefore = zoneOffsetMs(new Date(addDays(wallClock, -1)), timeZone);
  const offsetAfter = zoneOffsetMs(new Date(addDays(wallClock, 1)), timeZone);
  const exact = [wallClock - offsetBefore, wallClock - offsetAfter]
    .sort((left, right) => left - right)
    .find((candidate) => wallClockMs(candidate, timeZone) === wallClock);
  return new Date(exact ?? wallClock - offsetBefore);
}

/** "Tue 22 Sep · 16:11" in `timeZone`, for the header. */
export function formatHeaderTime(instant: Date, timeZone: string): string {
  const parts = dateParts(instant, timeZone);
  return `${parts.weekday} ${parts.day} ${parts.month} · ${localTimeString(instant, timeZone)}`;
}

/** "2 Sep" in `timeZone`. */
export function formatShortDate(instant: Date, timeZone: string): string {
  const parts = dateParts(instant, timeZone);
  return `${parts.day} ${parts.month}`;
}

/**
 * How long ago, as in the Today rail: "12m ago", "2h ago", "yesterday", a
 * weekday within the week, and "2 Sep" before that.
 */
export function formatSince(
  instant: Date,
  now: Date,
  timeZone: string,
): string {
  const minutes = Math.floor((now.getTime() - instant.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const days = Math.round(
    (localDate(now, timeZone) - localDate(instant, timeZone)) / DAY_MS,
  );
  if (days <= 0) return `${Math.floor(minutes / 60)}h ago`;
  if (days === 1) return "yesterday";
  if (days < 7) return dateParts(instant, timeZone).weekday;
  return formatShortDate(instant, timeZone);
}

function dateParts(instant: Date, timeZone: string): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      day: "numeric",
      month: "short",
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
}

/** "YYYY-MM-DD" in `timeZone`. */
export function localDateString(instant: Date, timeZone: string): string {
  return new Date(wallClockMs(instant.getTime(), timeZone))
    .toISOString()
    .slice(0, 10);
}

/** "HH:MM" in `timeZone`. */
export function localTimeString(instant: Date, timeZone: string): string {
  return new Date(wallClockMs(instant.getTime(), timeZone))
    .toISOString()
    .slice(11, 16);
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
