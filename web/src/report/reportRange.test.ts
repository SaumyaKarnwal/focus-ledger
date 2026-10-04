import { describe, expect, test } from "vitest";
import {
  comparedSpans,
  type RangeChoice,
  rangeOf,
  rangeTitle,
} from "./reportRange";

// Tuesday 22 September 2026, 14:00 in Berlin (12:00 UTC), as on the boards.
const NOW = new Date("2026-09-22T12:00:00Z");
const ZONE = "Europe/Berlin";

const iso = (date: Date) => date.toISOString();

function title(choice: RangeChoice) {
  return rangeTitle(choice, NOW, ZONE);
}

describe("rangeTitle (board R-Report-Range)", () => {
  test.each<[RangeChoice, string, string]>([
    [{ kind: "today", back: 0 }, "Today", "Tuesday, 22 September"],
    [{ kind: "today", back: 1 }, "Yesterday", "Monday, 21 September"],
    [{ kind: "today", back: 2 }, "Sun 20 Sep", "2 days ago"],
    [
      { kind: "week", back: 0 },
      "This week",
      "Mon 21 – Sun 27 September, so far",
    ],
    [{ kind: "week", back: 1 }, "Last week", "Mon 14 – Sun 20 September"],
    [{ kind: "week", back: 2 }, "7 – 13 Sep", "2 weeks ago"],
    [{ kind: "month", back: 0 }, "This month", "1 – 22 September, so far"],
    [{ kind: "month", back: 1 }, "Last month", "1 – 31 August"],
    [{ kind: "month", back: 2 }, "July", "2 months ago"],
    [{ kind: "month", back: 9 }, "December 2025", "9 months ago"],
  ])("rangeTitle_%o", (choice, expectedTitle, dates) => {
    expect(title(choice)).toEqual({ title: expectedTitle, dates });
  });

  test("rangeTitle_weekAcrossAMonth_namesBothMonths", () => {
    const now = new Date("2026-10-15T12:00:00Z");

    expect(rangeTitle({ kind: "week", back: 2 }, now, ZONE).title).toBe(
      "28 Sep – 4 Oct",
    );
  });

  test("rangeTitle_thisWeekAcrossAMonth_namesBothMonths", () => {
    const now = new Date("2026-11-01T12:00:00Z");

    expect(rangeTitle({ kind: "week", back: 0 }, now, ZONE).dates).toBe(
      "Mon 26 Oct – Sun 1 November, so far",
    );
  });

  test("rangeTitle_custom_namesTheSpanAndItsLength", () => {
    expect(
      title({
        kind: "custom",
        back: 0,
        custom: { from: "2026-09-03", to: "2026-09-09" },
      }),
    ).toEqual({ title: "3 – 9 Sep", dates: "7 days" });
  });
});

describe("rangeOf", () => {
  test("rangeOf_weekBack_isMondayToMondayInTheZone", () => {
    const range = rangeOf({ kind: "week", back: 1 }, NOW, ZONE);

    expect(iso(range.start)).toBe("2026-09-13T22:00:00.000Z");
    expect(iso(range.end)).toBe("2026-09-20T22:00:00.000Z");
  });

  test("rangeOf_dayAcrossTheClockChange_isTwentyFiveHours", () => {
    // Berlin goes back from summer time on Sunday 25 October 2026.
    const range = rangeOf(
      { kind: "today", back: 1 },
      new Date("2026-10-26T12:00:00Z"),
      ZONE,
    );

    expect(range.end.getTime() - range.start.getTime()).toBe(25 * 3600_000);
  });

  test("rangeOf_customBack_stepsByTheSpansLength", () => {
    const custom = { from: "2026-09-03", to: "2026-09-09" };

    const range = rangeOf({ kind: "custom", back: 1, custom }, NOW, ZONE);

    expect(iso(range.start)).toBe("2026-08-26T22:00:00.000Z");
    expect(iso(range.end)).toBe("2026-09-02T22:00:00.000Z");
  });
});

describe("comparedSpans (README Report rules 2)", () => {
  test("comparedSpans_runningWeek_comparesTheSameElapsedPart", () => {
    const { current, before } = comparedSpans(
      { kind: "week", back: 0 },
      NOW,
      ZONE,
    );

    expect(iso(current.start)).toBe("2026-09-20T22:00:00.000Z");
    expect(iso(current.end)).toBe(iso(NOW));
    expect(iso(before.start)).toBe("2026-09-13T22:00:00.000Z");
    expect(iso(before.end)).toBe("2026-09-15T12:00:00.000Z");
  });

  test("comparedSpans_finishedWeek_comparesWholeWeeks", () => {
    const { current, before } = comparedSpans(
      { kind: "week", back: 1 },
      NOW,
      ZONE,
    );

    expect(iso(current.end)).toBe("2026-09-20T22:00:00.000Z");
    expect(iso(before.start)).toBe("2026-09-06T22:00:00.000Z");
    expect(iso(before.end)).toBe("2026-09-13T22:00:00.000Z");
  });
});
