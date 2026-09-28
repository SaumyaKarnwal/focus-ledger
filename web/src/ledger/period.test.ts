import { describe, expect, test } from "vitest";
import { exampleExpected, exampleNow } from "./exampleData";
import { dayRange, isInRange, toPeriodPb, weekRange } from "./period";

const HOUR_MS = 3_600_000;

function iso(range: { start: Date; end: Date }) {
  return { start: range.start.toISOString(), end: range.end.toISOString() };
}

function hours(range: { start: Date; end: Date }) {
  return (range.end.getTime() - range.start.getTime()) / HOUR_MS;
}

function toIsoMillis(value: string) {
  return new Date(value).toISOString();
}

describe("dayRange and weekRange", () => {
  test.each(exampleExpected.periods.map((period) => [period.timeZone, period]))(
    "ranges_exampleNowIn%s_matchExpectedUtcRanges",
    (timeZone, period) => {
      expect(iso(dayRange(exampleNow, timeZone))).toEqual({
        start: toIsoMillis(period.today.start),
        end: toIsoMillis(period.today.end),
      });
      expect(iso(weekRange(exampleNow, timeZone))).toEqual({
        start: toIsoMillis(period.week.start),
        end: toIsoMillis(period.week.end),
      });
    },
  );

  test("dayRange_springForwardInLosAngeles_has23Hours", () => {
    const range = dayRange(
      new Date("2026-03-08T20:00:00Z"),
      "America/Los_Angeles",
    );

    expect(iso(range).start).toBe("2026-03-08T08:00:00.000Z");
    expect(hours(range)).toBe(23);
  });

  test("dayRange_fallBackInLosAngeles_has25Hours", () => {
    expect(hours(dayRange(exampleNow, "America/Los_Angeles"))).toBe(25);
  });

  test("dayRange_justBeforeLocalMidnight_staysOnThatDay", () => {
    const range = dayRange(
      new Date("2026-11-02T07:59:59Z"),
      "America/Los_Angeles",
    );

    expect(iso(range).start).toBe("2026-11-01T07:00:00.000Z");
  });

  test("dayRange_atLocalMidnight_startsTheNextDay", () => {
    const range = dayRange(
      new Date("2026-11-02T08:00:00Z"),
      "America/Los_Angeles",
    );

    expect(iso(range).start).toBe("2026-11-02T08:00:00.000Z");
  });

  test("dayRange_zoneAheadOfUtc_startsOnThePreviousUtcDay", () => {
    const range = dayRange(new Date("2026-11-01T20:00:00Z"), "Asia/Kolkata");

    expect(iso(range)).toEqual({
      start: "2026-11-01T18:30:00.000Z",
      end: "2026-11-02T18:30:00.000Z",
    });
  });

  test("weekRange_onMonday_startsThatMonday", () => {
    const range = weekRange(new Date("2026-10-26T00:00:00Z"), "UTC");

    expect(iso(range).start).toBe("2026-10-26T00:00:00.000Z");
    expect(hours(range)).toBe(7 * 24);
  });

  test("weekRange_onSunday_startsThePreviousMonday", () => {
    const range = weekRange(new Date("2026-11-01T23:59:59Z"), "UTC");

    expect(iso(range).start).toBe("2026-10-26T00:00:00.000Z");
  });
});

describe("isInRange", () => {
  test("isInRange_endInstant_isExcluded", () => {
    const range = dayRange(exampleNow, "UTC");

    expect(isInRange(range.start, range)).toBe(true);
    expect(isInRange(range.end, range)).toBe(false);
  });
});

describe("toPeriodPb", () => {
  test("toPeriodPb_utcRange_keepsBothInstants", () => {
    const period = toPeriodPb(dayRange(exampleNow, "UTC"));

    expect(period.start?.seconds).toBe(
      BigInt(Date.parse("2026-11-01T00:00:00Z") / 1000),
    );
    expect(period.end?.seconds).toBe(
      BigInt(Date.parse("2026-11-02T00:00:00Z") / 1000),
    );
  });
});
