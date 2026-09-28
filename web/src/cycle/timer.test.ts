import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { describe, expect, test } from "vitest";
import { CyclePbSchema, FocusMode } from "../gen/focusledger/v1/model_pb";
import {
  endTime,
  formatCountdown,
  hasEnded,
  minutesToLog,
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
    [40 * MINUTE_MS, "40:00"],
    [59_001, "01:00"],
    [59_000, "00:59"],
    [0, "00:00"],
    [90 * MINUTE_MS, "1:30:00"],
  ])("formatCountdown_%sMs_is%s", (ms, expected) => {
    expect(formatCountdown(ms)).toBe(expected);
  });
});
