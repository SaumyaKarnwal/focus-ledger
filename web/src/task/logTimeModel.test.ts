import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { describe, expect, test } from "vitest";
import { CyclePbSchema, FocusMode } from "../gen/focusledger/v1/model_pb";
import { exampleNodesWithNothingRunning } from "../testing/appHarness";
import { INBOX_ID, type TodayData } from "../today/todayModel";
import {
  cycleDaysOf,
  defaultLogTask,
  endClock,
  formatClock,
  logEntries,
  logSpan,
  monthGrid,
  monthLabel,
  overlappingCycle,
  parseStartTime,
  shiftMonth,
  totalMinutes,
  whenLabel,
} from "./logTimeModel";

const rows = (
  deep: [number, number],
  execution: [number, number],
  shallow: [number, number],
) => ({
  [FocusMode.DEEP_FOCUS]: { cycleMinutes: deep[0], cycleCount: deep[1] },
  [FocusMode.EXECUTION]: {
    cycleMinutes: execution[0],
    cycleCount: execution[1],
  },
  [FocusMode.SHALLOW]: { cycleMinutes: shallow[0], cycleCount: shallow[1] },
});

describe("Log time model (README Log time)", () => {
  test("parseStartTime_twelveHourEntries_becomeTwentyFourHourTimes", () => {
    expect(parseStartTime("3:30", "pm")).toBe("15:30");
    expect(parseStartTime("03:30", "am")).toBe("03:30");
    expect(parseStartTime("930", "am")).toBe("09:30");
    expect(parseStartTime("12:05", "am")).toBe("00:05");
    expect(parseStartTime("12:05", "pm")).toBe("12:05");
  });

  test("parseStartTime_noMeridiemOrAWrongTime_isNoTime", () => {
    expect(parseStartTime("3:30", undefined)).toBeUndefined();
    expect(parseStartTime("", "pm")).toBeUndefined();
    expect(parseStartTime("13:00", "pm")).toBeUndefined();
    expect(parseStartTime("0:30", "am")).toBeUndefined();
    expect(parseStartTime("3:60", "am")).toBeUndefined();
    expect(parseStartTime("--:--", "am")).toBeUndefined();
  });

  test("totalMinutes_andEndClock_countEveryCycle", () => {
    const time = rows([60, 1], [45, 1], [30, 0]);

    expect(totalMinutes(time)).toBe(105);
    expect(endClock("15:30", totalMinutes(time))).toBe("5:15 pm");
    expect(endClock("23:30", 90)).toBe("1:00 am");
    expect(formatClock("00:00")).toBe("12:00 am");
  });

  test("whenLabel_namesTodayAndYesterday_andDatesOlderDays", () => {
    const now = new Date("2026-09-22T10:00:00Z");

    expect(whenLabel("2026-09-22", "09:00", now, "UTC")).toBe(
      "Today · 9:00 am",
    );
    expect(whenLabel("2026-09-21", undefined, now, "UTC")).toBe("Yesterday");
    expect(whenLabel("2026-09-14", "15:30", now, "UTC")).toBe(
      "Mon 14 Sep · 3:30 pm",
    );
  });

  test("whenLabel_usesTheUsersDay", () => {
    // 01:30 UTC on 23 September is still 22 September in Los Angeles.
    const now = new Date("2026-09-23T01:30:00Z");

    expect(whenLabel("2026-09-22", undefined, now, "America/Los_Angeles")).toBe(
      "Today",
    );
  });

  test("monthGrid_startsOnMonday_andMarksTodayFutureAndCycleDays", () => {
    const grid = monthGrid("2026-09", "2026-09-22", new Set(["2026-09-21"]));

    // 1 September 2026 is a Tuesday: one empty cell before it.
    expect(grid[0]).toBeUndefined();
    expect(grid[1]?.date).toBe("2026-09-01");
    expect(grid).toHaveLength(31);
    const day = (date: number) => grid.find((cell) => cell?.day === date);
    expect(day(21)).toMatchObject({ hasCycles: true, isToday: false });
    expect(day(22)).toMatchObject({ isToday: true, isFuture: false });
    expect(day(23)).toMatchObject({ isFuture: true });
  });

  test("monthLabel_andShiftMonth_crossTheYear", () => {
    expect(monthLabel("2026-09")).toBe("September 2026");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });

  test("cycleDaysOf_isTheLocalStartDay", () => {
    const nodes = exampleNodesWithNothingRunning();
    const cycles = nodes.flatMap((node) => node.cycles);

    const days = cycleDaysOf(cycles, "UTC");

    expect(days.size).toBeGreaterThan(0);
    days.forEach((day) => expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/));
  });

  test("defaultLogTask_isTheLastTaskWorked_orNotSureYet", () => {
    const nodes = exampleNodesWithNothingRunning();
    const data = { allTimeNodes: nodes, weekNodes: nodes } as TodayData;

    expect(defaultLogTask(data)).not.toBe(INBOX_ID);
    expect(
      defaultLogTask({
        allTimeNodes: [],
        weekNodes: [],
      } as unknown as TodayData),
    ).toBe(INBOX_ID);
  });
});

describe("Log time entries (README Log time, issue 268)", () => {
  const ids = ["a", "b", "c", "d", "e"];
  const clock = (entry: { startedAt: Date; minutes: number }) => [
    entry.startedAt.toISOString().slice(11, 16),
    new Date(entry.startedAt.getTime() + entry.minutes * 60_000)
      .toISOString()
      .slice(11, 16),
  ];

  test("logEntries_designExample_runBackToBackWithNoSharedStart", () => {
    // Start 9:00, Deep Focus 60 × 1 and Execution 30 × 2.
    const entries = logEntries(
      {
        nodeId: "task",
        day: "2026-09-21",
        start: "09:00",
        time: rows([60, 1], [30, 2], [25, 0]),
      },
      "UTC",
      ids,
    );

    expect(entries.map(clock)).toEqual([
      ["09:00", "10:00"],
      ["10:00", "10:30"],
      ["10:30", "11:00"],
    ]);
    expect(entries.map((entry) => entry.mode)).toEqual([
      FocusMode.DEEP_FOCUS,
      FocusMode.EXECUTION,
      FocusMode.EXECUTION,
    ]);
    expect(entries.map((entry) => entry.requestId)).toEqual(["a", "b", "c"]);
  });

  test("logEntries_orderIsDeepFocusThenExecutionThenShallow", () => {
    const entries = logEntries(
      {
        nodeId: "task",
        day: "2026-09-21",
        start: "15:30",
        time: rows([60, 1], [45, 1], [30, 1]),
      },
      "UTC",
      ids,
    );

    expect(entries.map((entry) => entry.mode)).toEqual([
      FocusMode.DEEP_FOCUS,
      FocusMode.EXECUTION,
      FocusMode.SHALLOW,
    ]);
    expect(entries.map(clock)).toEqual([
      ["15:30", "16:30"],
      ["16:30", "17:15"],
      ["17:15", "17:45"],
    ]);
  });

  test("logEntries_startIsInTheUsersTimeZone", () => {
    const [entry] = logEntries(
      {
        nodeId: "task",
        day: "2026-09-21",
        start: "09:00",
        time: rows([60, 1], [45, 0], [30, 0]),
      },
      "America/Los_Angeles",
      ids,
    );

    // 9:00 in Los Angeles in September is 16:00 UTC.
    expect(entry.startedAt.toISOString()).toBe("2026-09-21T16:00:00.000Z");
  });

  test("logEntries_notSureYet_hasNoTask", () => {
    const [entry] = logEntries(
      {
        nodeId: INBOX_ID,
        day: "2026-09-21",
        start: "09:00",
        time: rows([60, 1], [45, 0], [30, 0]),
      },
      "UTC",
      ids,
    );

    expect(entry.nodeId).toBeUndefined();
  });

  test("overlappingCycle_findsAnOverlap_butNotACycleThatEndsAtTheStart", () => {
    const cycle = create(CyclePbSchema, {
      mode: FocusMode.EXECUTION,
      plannedMinutes: 50,
      minutes: 50,
      startedAt: timestampFromDate(new Date("2026-09-21T08:10:00Z")),
    });
    const spanFrom = (start: string) =>
      logSpan(
        logEntries(
          {
            nodeId: "task",
            day: "2026-09-21",
            start,
            time: rows([60, 1], [45, 0], [30, 0]),
          },
          "UTC",
          ids,
        ),
      );

    // The cycle runs 8:10–9:00.
    expect(overlappingCycle(spanFrom("08:30")!, [cycle])).toBe(cycle);
    expect(overlappingCycle(spanFrom("07:30")!, [cycle])).toBe(cycle);
    expect(overlappingCycle(spanFrom("09:00")!, [cycle])).toBeUndefined();
    expect(overlappingCycle(spanFrom("07:10")!, [cycle])).toBeUndefined();
  });
});
