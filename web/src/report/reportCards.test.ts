import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { describe, expect, test } from "vitest";
import {
  CyclePbSchema,
  FocusMode,
  NodePbSchema,
  type NodePb,
} from "../gen/focusledger/v1/model_pb";
import { LOGGED_MODES } from "../ledger/rollup";
import {
  changeLabel,
  cyclesIn,
  daysUpToNow,
  kindOfFocus,
  minutesByHour,
  minutesOf,
  peakLine,
  whereItWent,
} from "./reportCards";

const ZONE = "UTC";

function cycle(start: string, minutes: number, mode = FocusMode.DEEP_FOCUS) {
  return create(CyclePbSchema, {
    id: `${start}-${minutes}`,
    startedAt: timestampFromDate(new Date(start)),
    plannedMinutes: minutes,
    minutes,
    mode,
  });
}

function node(
  id: string,
  name: string,
  cycles: ReturnType<typeof cycle>[] = [],
  parentId?: string,
): NodePb {
  return create(NodePbSchema, { id, name, parentId, cycles });
}

const inbox = (cycles: ReturnType<typeof cycle>[]) =>
  create(NodePbSchema, { cycles });

const day = {
  start: new Date("2026-09-22T00:00:00Z"),
  end: new Date("2026-09-23T00:00:00Z"),
};

describe("the total and its change", () => {
  test("cyclesIn_countsOnlyCyclesThatStartInTheSpan", () => {
    const nodes = [
      node("a", "Harbour", [
        cycle("2026-09-21T23:30:00Z", 60),
        cycle("2026-09-22T09:00:00Z", 50),
      ]),
    ];

    expect(minutesOf(cyclesIn(nodes, day))).toBe(50);
  });

  test.each([
    [860, 730, "+2h 10m"],
    [100, 145, "−45m"],
    [60, 60, "±0m"],
    [60, 0, undefined],
  ])("changeLabel_%i_against_%i", (now, before, label) => {
    expect(changeLabel(now, before)).toBe(label);
  });
});

describe("Kind of focus", () => {
  test("kindOfFocus_givesMinutesAndShares", () => {
    const placed = cyclesIn(
      [
        node("a", "A", [
          cycle("2026-09-22T09:00:00Z", 60),
          cycle("2026-09-22T11:00:00Z", 30, FocusMode.EXECUTION),
          cycle("2026-09-22T12:00:00Z", 10, FocusMode.SHALLOW),
        ]),
      ],
      day,
    );

    expect(
      kindOfFocus(placed).map((share) => [share.minutes, share.percent]),
    ).toEqual([
      [60, 60],
      [30, 30],
      [10, 10],
    ]);
  });
});

describe("Where it went", () => {
  test("whereItWent_rollsSubtasksUpAndKeepsUntagged", () => {
    const nodes = [
      node("h", "Harbour", [cycle("2026-09-22T08:00:00Z", 30)]),
      node("c", "Chapter", [cycle("2026-09-22T09:00:00Z", 60)], "h"),
      node("a", "Admin", [cycle("2026-09-22T10:00:00Z", 45)]),
      inbox([cycle("2026-09-22T11:00:00Z", 20)]),
    ];

    expect(
      whereItWent(nodes, cyclesIn(nodes, day)).map((part) => [
        part.name,
        part.minutes,
      ]),
    ).toEqual([
      ["Harbour", 90],
      ["Admin", 45],
      ["Untagged", 20],
    ]);
  });

  test("whereItWent_moreThanSixTasks_joinsTheSmallestIntoOne", () => {
    const nodes = Array.from({ length: 8 }, (_, index) =>
      node(String(index), `Task ${index}`, [
        cycle(`2026-09-22T0${index}:00:00Z`, 80 - index * 10),
      ]),
    );

    const parts = whereItWent(nodes, cyclesIn(nodes, day));

    expect(parts).toHaveLength(6);
    expect(parts[5]).toMatchObject({ name: "3 more", minutes: 30 + 20 + 10 });
  });
});

describe("When you focus (README Report rules 1)", () => {
  test("minutesByHour_spreadsACycleOverTheHoursItSpans", () => {
    const placed = cyclesIn(
      [node("a", "A", [cycle("2026-09-22T09:40:00Z", 50)])],
      day,
    );

    const hours = minutesByHour(placed, ZONE, 1)[FocusMode.DEEP_FOCUS];

    expect(hours[9]).toBe(20);
    expect(hours[10]).toBe(30);
  });

  test("minutesByHour_inAZone_usesTheLocalClock", () => {
    const placed = cyclesIn(
      [node("a", "A", [cycle("2026-09-22T07:00:00Z", 60)])],
      day,
    );

    expect(
      minutesByHour(placed, "Europe/Berlin", 1)[FocusMode.DEEP_FOCUS][9],
    ).toBe(60);
  });

  test("minutesByHour_averagesOverTheDays", () => {
    const placed = cyclesIn(
      [node("a", "A", [cycle("2026-09-22T09:00:00Z", 60)])],
      day,
    );

    expect(minutesByHour(placed, ZONE, 4)[FocusMode.DEEP_FOCUS][9]).toBe(15);
  });

  test("daysUpToNow_countsEmptyDaysButNotTheFuture", () => {
    const week = {
      start: new Date("2026-09-21T00:00:00Z"),
      end: new Date("2026-09-28T00:00:00Z"),
    };

    expect(daysUpToNow(week, new Date("2026-09-22T12:00:00Z"), ZONE)).toBe(2);
    expect(daysUpToNow(week, new Date("2026-10-05T12:00:00Z"), ZONE)).toBe(7);
  });

  test("peakLine_namesTheBiggestModeAndItsHours", () => {
    const hours = Object.fromEntries(
      LOGGED_MODES.map((mode) => [mode, Array.from({ length: 24 }, () => 0)]),
    ) as ReturnType<typeof minutesByHour>;
    hours[FocusMode.DEEP_FOCUS][9] = 10;
    hours[FocusMode.DEEP_FOCUS][10] = 9;
    hours[FocusMode.DEEP_FOCUS][11] = 2;
    hours[FocusMode.EXECUTION][14] = 6;

    expect(peakLine(hours, true)).toBe("Deep Focus peaks 9 – 11am.");
    expect(peakLine(hours, false)).toBe("Deep Focus peaked 9 – 11am.");
  });

  test("peakLine_noTime_isUndefined", () => {
    const hours = Object.fromEntries(
      LOGGED_MODES.map((mode) => [mode, Array.from({ length: 24 }, () => 0)]),
    ) as ReturnType<typeof minutesByHour>;

    expect(peakLine(hours, true)).toBeUndefined();
  });
});
