import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { describe, expect, test } from "vitest";
import {
  CyclePbSchema,
  FocusMode,
  NodePbSchema,
} from "../gen/focusledger/v1/model_pb";
import { cyclesIn } from "./reportCards";
import {
  barsByDay,
  barsByWeek,
  finishedCycles,
  setAndDo,
  yearOf,
} from "./reportYear";

const ZONE = "UTC";
// Tuesday 22 September 2026, as on the boards.
const NOW = new Date("2026-09-22T15:00:00Z");

function cycle(
  start: string,
  minutes: number,
  planned = minutes,
  mode = FocusMode.DEEP_FOCUS,
) {
  return create(CyclePbSchema, {
    id: `${start}-${minutes}`,
    startedAt: timestampFromDate(new Date(start)),
    plannedMinutes: planned,
    minutes,
    mode,
  });
}

const all = {
  start: new Date("2025-01-01T00:00:00Z"),
  end: new Date("2027-01-01T00:00:00Z"),
};
const placed = (cycles: ReturnType<typeof cycle>[]) =>
  cyclesIn([create(NodePbSchema, { id: "a", name: "A", cycles })], all);

describe("What you set, what you do (Report rules 4)", () => {
  test("setAndDo_averagesThePlannedAndTheActualLength", () => {
    const rows = setAndDo(
      placed([
        cycle("2026-09-21T09:00:00Z", 40, 60),
        cycle("2026-09-22T09:00:00Z", 54, 60),
        cycle("2026-09-22T11:00:00Z", 45, 45, FocusMode.EXECUTION),
      ]),
    );

    expect(rows.map((row) => [row.set, row.done, row.cycles])).toEqual([
      [60, 47, 2],
      [45, 45, 1],
      [0, 0, 0],
    ]);
  });
});

describe("Cycles you finished", () => {
  test("finishedCycles_ranToTheBellWhenItLoggedItsPlannedLength", () => {
    const counts = finishedCycles(
      placed([
        cycle("2026-09-22T09:00:00Z", 60, 60),
        cycle("2026-09-22T10:00:00Z", 75, 60),
        cycle("2026-09-22T11:00:00Z", 20, 60),
      ]),
    );

    expect(counts[FocusMode.DEEP_FOCUS]).toEqual({ bell: 2, stopped: 1 });
    expect(counts[FocusMode.SHALLOW]).toEqual({ bell: 0, stopped: 0 });
  });
});

describe("The small bar cards", () => {
  test("barsByDay_givesEachDayItsMinutesAndMarksToday", () => {
    const week = {
      start: new Date("2026-09-21T00:00:00Z"),
      end: new Date("2026-09-28T00:00:00Z"),
    };
    const bars = barsByDay(
      placed([
        cycle("2026-09-21T09:00:00Z", 30),
        cycle("2026-09-22T09:00:00Z", 45),
      ]),
      week,
      NOW,
      ZONE,
      (day) => day.toISOString().slice(8, 10),
    );

    expect(
      bars.map((bar) => [bar.label, bar.minutes, bar.current, bar.future]),
    ).toEqual([
      ["21", 30, false, false],
      ["22", 45, true, false],
      ["23", 0, false, true],
      ["24", 0, false, true],
      ["25", 0, false, true],
      ["26", 0, false, true],
      ["27", 0, false, true],
    ]);
  });

  test("barsByWeek_splitsTheMonthIntoMondayWeeksUpToToday", () => {
    const september = {
      start: new Date("2026-09-01T00:00:00Z"),
      end: new Date("2026-10-01T00:00:00Z"),
    };
    const bars = barsByWeek(
      placed([cycle("2026-09-15T09:00:00Z", 60)]),
      september,
      NOW,
      ZONE,
    );

    expect(bars.map((bar) => [bar.label, bar.minutes])).toEqual([
      ["1 – 6", 0],
      ["7 – 13", 0],
      ["14 – 20", 60],
      ["21 – 22", 0],
    ]);
  });
});

describe("Your year", () => {
  const nodes = (cycles: ReturnType<typeof cycle>[]) => [
    create(NodePbSchema, { id: "a", name: "A", cycles }),
  ];

  test("yearOf_coversTwelveMonthsFromLastOctober", () => {
    const year = yearOf(nodes([]), NOW, ZONE);

    expect(year.months.filter(Boolean)).toEqual([
      "Oct",
      "Nov",
      "Dec",
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
    ]);
    expect(year.since).toBe("last October");
    expect(year.weeks.every((week) => week.length <= 7)).toBe(true);
    // 1 October 2025 is a Wednesday: the first column starts with two blanks.
    expect(year.weeks[0].slice(0, 3).map((day) => day?.date)).toEqual([
      undefined,
      undefined,
      "2025-10-01",
    ]);
  });

  test("yearOf_streakEndsTodayOrYesterday_andBestIsTheLongestRun", () => {
    const year = yearOf(
      nodes([
        cycle("2026-09-01T09:00:00Z", 20),
        cycle("2026-09-02T09:00:00Z", 20),
        cycle("2026-09-03T09:00:00Z", 20),
        cycle("2026-09-04T09:00:00Z", 20),
        cycle("2026-09-20T09:00:00Z", 20),
        cycle("2026-09-21T09:00:00Z", 20),
      ]),
      NOW,
      ZONE,
    );

    expect(year.streak).toBe(2);
    expect(year.best).toBe(4);
    expect(year.daysWithFocus).toBe(6);
  });

  test("yearOf_levelsFollowTheMinutesOfTheDay", () => {
    const year = yearOf(
      nodes([
        cycle("2026-09-21T09:00:00Z", 200),
        cycle("2026-09-22T09:00:00Z", 10),
      ]),
      NOW,
      ZONE,
    );
    const days = year.weeks.flat().filter((day) => day !== undefined);

    expect(days.find((day) => day.date === "2026-09-21")?.level).toBe(4);
    expect(days.find((day) => day.date === "2026-09-22")?.level).toBe(1);
    expect(year.streak).toBe(2);
  });

  test("yearOf_dayBoundary_usesTheLocalDate", () => {
    // 23:30 UTC on 21 September is 22 September in Tokyo.
    const year = yearOf(
      nodes([cycle("2026-09-21T23:30:00Z", 30)]),
      NOW,
      "Asia/Tokyo",
    );
    const days = year.weeks.flat().filter((day) => day !== undefined);

    expect(days.find((day) => day.date === "2026-09-22")?.minutes).toBe(30);
    expect(days.find((day) => day.date === "2026-09-21")?.minutes).toBe(0);
  });
});
