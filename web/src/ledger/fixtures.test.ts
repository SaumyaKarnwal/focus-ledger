import { timestampDate } from "@bufbuild/protobuf/wkt";
import { describe, expect, test } from "vitest";
import { exampleNodes, exampleNow } from "./exampleData";
import { fixtureNodes, selectFixture, shiftToNow } from "./fixtures";
import { overallTotals, runningCycle } from "./rollup";

const NOW = new Date("2026-09-28T09:00:00Z");
const HOUR_MS = 3_600_000;

describe("fixtures", () => {
  test("shiftToNow_exampleRows_keepTheGapsBetweenTimes", () => {
    const shifted = shiftToNow(exampleNodes(), exampleNow, NOW);
    const startsOf = (nodes: ReturnType<typeof exampleNodes>) =>
      nodes
        .flatMap((node) => node.cycles)
        .map((cycle) => timestampDate(cycle.startedAt!).getTime());

    const offsets = startsOf(shifted).map(
      (start, index) => start - startsOf(exampleNodes())[index],
    );

    expect(new Set(offsets)).toEqual(
      new Set([NOW.getTime() - exampleNow.getTime()]),
    );
    expect(overallTotals(shifted)).toEqual(overallTotals(exampleNodes()));
  });

  test("shiftToNow_createdAt_movesByTheSameOffset", () => {
    const [, book] = shiftToNow(exampleNodes(), exampleNow, NOW);

    expect(timestampDate(book.createdAt!).toISOString()).toBe(
      new Date(
        Date.parse("2026-10-01T08:00:00Z") +
          (NOW.getTime() - exampleNow.getTime()),
      ).toISOString(),
    );
  });

  test("fixtureNodes_running_hasTwentyMinutesLeft", () => {
    const running = runningCycle(fixtureNodes("running", NOW));

    expect(timestampDate(running!.startedAt!)).toEqual(
      new Date(NOW.getTime() - 0.5 * HOUR_MS),
    );
  });

  test("fixtureNodes_endedAndToday_setTheRunningCycle", () => {
    const ended = runningCycle(fixtureNodes("ended", NOW));

    expect(timestampDate(ended!.startedAt!)).toEqual(
      new Date(NOW.getTime() - HOUR_MS),
    );
    expect(runningCycle(fixtureNodes("today", NOW))).toBeUndefined();
    expect(fixtureNodes("empty", NOW)).toEqual([]);
  });

  test.each([
    ["", "today"],
    ["?fixture=empty", "empty"],
    ["?backend=fake&fixture=ended", "ended"],
    ["?fixture=other", "today"],
  ])("selectFixture_search%j_is%s", (search, expected) => {
    expect(selectFixture(search)).toBe(expected);
  });
});
