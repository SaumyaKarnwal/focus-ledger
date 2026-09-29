import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { describe, expect, test } from "vitest";
import { CyclePbSchema, FocusMode } from "../gen/focusledger/v1/model_pb";
import {
  endTime,
  extensionRemainingMs,
  extensionTotalMinutes,
  formatCountdown,
  hasEnded,
  minutesToLog,
  pausedMs,
  pauseTooLong,
  remainingMs,
} from "./timer";

const START = new Date("2026-11-01T19:30:00Z");
const MINUTE_MS = 60_000;

const running = create(CyclePbSchema, {
  mode: FocusMode.EXECUTION,
  plannedMinutes: 50,
  startedAt: timestampFromDate(START),
});

function at(minutes: number): Date {
  return new Date(START.getTime() + minutes * MINUTE_MS);
}

describe("timer", () => {
  test("remainingMs_tenMinutesIn_leavesForty", () => {
    expect(remainingMs(running, at(10))).toBe(40 * MINUTE_MS);
  });

  test("remainingMs_pastTheEnd_isZero", () => {
    expect(remainingMs(running, at(70))).toBe(0);
    expect(hasEnded(running, at(70))).toBe(true);
  });

  test("pausedTime_leavesTheWorkAndMovesTheEnd", () => {
    const pause = { totalMs: 3 * MINUTE_MS, sinceMs: at(20).getTime() };

    expect(pausedMs(pause, at(22))).toBe(5 * MINUTE_MS);
    expect(minutesToLog(running, at(22), pausedMs(pause, at(22)))).toBe(17);
    expect(remainingMs(running, at(22), pausedMs(pause, at(22)))).toBe(
      33 * MINUTE_MS,
    );
    expect(endTime(running, 5 * MINUTE_MS)).toEqual(at(55));
  });

  test("pauseTooLong_atTenMinutes_isTrue", () => {
    const pause = { totalMs: 0, sinceMs: at(5).getTime() };

    expect(pauseTooLong(pause, at(14.9))).toBe(false);
    expect(pauseTooLong(pause, at(15))).toBe(true);
    expect(pauseTooLong({ totalMs: 20 * MINUTE_MS }, at(40))).toBe(false);
  });

  test("endTime_plannedFifty_isFiftyMinutesAfterStart", () => {
    expect(endTime(running)).toEqual(at(50));
  });

  test.each([
    [0.3, 1],
    [1, 1],
    [12.9, 12],
    [50, 50],
    [90, 50],
  ])("minutesToLog_after%sMinutes_logs%s", (elapsedMinutes, expected) => {
    expect(minutesToLog(running, at(elapsedMinutes))).toBe(expected);
  });

  test.each([
    [0, 50],
    [6.5, 56],
    [15, 65],
    [40, 65],
  ])(
    "extensionTotalMinutes_after%sMinutes_is%s",
    (elapsedMinutes, expected) => {
      const extension = {
        startedAtMs: START.getTime(),
        minutes: 15,
        loggedMinutes: 50,
      };

      expect(extensionTotalMinutes(extension, at(elapsedMinutes))).toBe(
        expected,
      );
    },
  );

  test("extensionRemainingMs_pastTheEnd_isZero", () => {
    const extension = {
      startedAtMs: START.getTime(),
      minutes: 15,
      loggedMinutes: 50,
    };

    expect(extensionRemainingMs(extension, at(5))).toBe(10 * MINUTE_MS);
    expect(extensionRemainingMs(extension, at(20))).toBe(0);
  });

  test.each([
    [40 * MINUTE_MS, "40:00"],
    [59_001, "01:00"],
    [59_000, "00:59"],
    [0, "00:00"],
    [90 * MINUTE_MS, "1:30:00"],
  ])("formatCountdown_%sMs_is%s", (ms, expected) => {
    expect(formatCountdown(ms)).toBe(expected);
  });
});
