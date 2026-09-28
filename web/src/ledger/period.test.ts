import { describe, expect, test } from "vitest";
import { exampleExpected, exampleNow } from "./exampleData";
import {
  dateSpanRange,
  dayRange,
  formatHeaderTime,
  lastWeekRange,
  monthRange,
  formatShortDate,
  formatSince,
  isInRange,
  localDateString,
  localTimeString,
  toPeriodPb,
  weekRange,
  zonedDateTimeToInstant,
} from "./period";

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

  test("dayRange_zoneSkipsMidnight_startsAtTheOffsetChange", () => {
    const range = dayRange(
      new Date("2026-09-06T12:00:00Z"),
      "America/Santiago",
    );

    expect(iso(range)).toEqual({
      start: "2026-09-06T04:00:00.000Z",
      end: "2026-09-07T03:00:00.000Z",
    });
    expect(hours(range)).toBe(23);
  });

  test("dayRange_beforeSkippedMidnight_staysOnThePreviousDay", () => {
    const cycleStart = new Date("2026-09-06T03:30:00Z");

    const range = dayRange(cycleStart, "America/Santiago");

    expect(iso(range)).toEqual({
      start: "2026-09-05T04:00:00.000Z",
      end: "2026-09-06T04:00:00.000Z",
    });
    expect(isInRange(cycleStart, range)).toBe(true);
  });

  test("weekRange_weekWithSkippedMidnight_endsAtTheNextMonday", () => {
    const range = weekRange(
      new Date("2026-09-06T12:00:00Z"),
      "America/Santiago",
    );

    expect(iso(range)).toEqual({
      start: "2026-08-31T04:00:00.000Z",
      end: "2026-09-07T03:00:00.000Z",
    });
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

describe("zonedDateTimeToInstant", () => {
  test.each([
    ["UTC", "2026-11-01", "09:30", "2026-11-01T09:30:00.000Z"],
    ["America/Los_Angeles", "2026-10-30", "09:30", "2026-10-30T16:30:00.000Z"],
    ["America/Los_Angeles", "2026-11-02", "09:30", "2026-11-02T17:30:00.000Z"],
    ["Asia/Kolkata", "2026-11-01", "00:15", "2026-10-31T18:45:00.000Z"],
  ])(
    "zonedDateTimeToInstant_%s_%s_%s_is%s",
    (timeZone, date, time, expected) => {
      expect(zonedDateTimeToInstant(date, time, timeZone).toISOString()).toBe(
        expected,
      );
    },
  );

  test("zonedDateTimeToInstant_skippedTime_movesForwardByTheGap", () => {
    expect(
      zonedDateTimeToInstant(
        "2026-03-08",
        "02:30",
        "America/Los_Angeles",
      ).toISOString(),
    ).toBe("2026-03-08T10:30:00.000Z");
  });

  test("zonedDateTimeToInstant_timeThatOccursTwice_givesTheEarlierInstant", () => {
    expect(
      zonedDateTimeToInstant(
        "2026-11-01",
        "01:30",
        "America/Los_Angeles",
      ).toISOString(),
    ).toBe("2026-11-01T08:30:00.000Z");
  });

  test("localDateAndTimeStrings_roundTrip_giveTheSameInstant", () => {
    const instant = new Date("2026-11-01T06:30:00Z");
    const zone = "America/Los_Angeles";

    expect(localDateString(instant, zone)).toBe("2026-10-31");
    expect(localTimeString(instant, zone)).toBe("23:30");
    expect(
      zonedDateTimeToInstant(
        localDateString(instant, zone),
        localTimeString(instant, zone),
        zone,
      ),
    ).toEqual(instant);
  });
});

describe("formatHeaderTime", () => {
  test.each([
    ["UTC", "Sun 1 Nov · 20:00"],
    ["America/Los_Angeles", "Sun 1 Nov · 12:00"],
  ])("formatHeaderTime_%s_is%s", (timeZone, expected) => {
    expect(formatHeaderTime(exampleNow, timeZone)).toBe(expected);
  });
});

describe("formatSince", () => {
  const ago = (ms: number) => new Date(exampleNow.getTime() - ms);

  test.each([
    [20_000, "just now"],
    [12 * 60_000, "12m ago"],
    [2 * 3_600_000, "2h ago"],
    [26 * 3_600_000, "yesterday"],
    [3 * 86_400_000, "Thu"],
    [30 * 86_400_000, "2 Oct"],
  ])("formatSince_%sMsAgo_is%s", (ms, expected) => {
    expect(formatSince(ago(ms), exampleNow, "UTC")).toBe(expected);
  });

  test("formatShortDate_losAngeles_usesTheLocalDay", () => {
    expect(
      formatShortDate(new Date("2026-11-01T06:30:00Z"), "America/Los_Angeles"),
    ).toBe("31 Oct");
  });
});

describe("report ranges", () => {
  test("monthRange_losAngelesInNovember_coversTheLocalMonth", () => {
    expect(iso(monthRange(exampleNow, "America/Los_Angeles"))).toEqual({
      start: "2026-11-01T07:00:00.000Z",
      end: "2026-12-01T08:00:00.000Z",
    });
  });

  test("monthRange_december_endsInJanuary", () => {
    expect(iso(monthRange(new Date("2026-12-15T12:00:00Z"), "UTC"))).toEqual({
      start: "2026-12-01T00:00:00.000Z",
      end: "2027-01-01T00:00:00.000Z",
    });
  });

  test("lastWeekRange_sunday_isThePreviousMondayToMonday", () => {
    expect(iso(lastWeekRange(exampleNow, "UTC"))).toEqual({
      start: "2026-10-19T00:00:00.000Z",
      end: "2026-10-26T00:00:00.000Z",
    });
  });

  test("dateSpanRange_santiagoOnASkippedMidnight_startsAtTheOffsetChange", () => {
    expect(
      iso(dateSpanRange("2026-09-06", "2026-09-07", "America/Santiago")),
    ).toEqual({
      start: "2026-09-06T04:00:00.000Z",
      end: "2026-09-08T03:00:00.000Z",
    });
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
