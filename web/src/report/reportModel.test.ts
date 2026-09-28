import { enumFromJson } from "@bufbuild/protobuf";
import { describe, expect, test } from "vitest";
import { FocusModeSchema } from "../gen/focusledger/v1/model_pb";
import { exampleExpected, exampleNodes } from "../ledger/exampleData";
import { type ByMode, LOGGED_MODES } from "../ledger/rollup";
import { buildReport, percentDifference, share } from "./reportModel";

function byModeFromJson<T>(json: Record<string, T>): ByMode<T> {
  return Object.fromEntries(
    Object.entries(json).map(([name, value]) => [
      enumFromJson(FocusModeSchema, name as "FOCUS_MODE_DEEP_FOCUS"),
      value,
    ]),
  ) as ByMode<T>;
}

const expectedTree = new Map(
  exampleExpected.tree.map((row) => [row.nodeId, row.rolledUp]),
);

describe("buildReport", () => {
  test("buildReport_example_rowsMatchTheSharedRolledUpFigures", () => {
    const report = buildReport(exampleNodes());
    const flat = (rows: typeof report.rows): typeof report.rows =>
      rows.flatMap((row) => [row, ...flat(row.children)]);

    flat(report.rows).forEach((row) => {
      const expected = expectedTree.get(row.nodeId)!;
      expect(row.totals).toEqual({
        minutes: expected.minutes,
        minutesByMode: byModeFromJson(expected.minutesByMode),
      });
    });
    expect(flat(report.rows).map((row) => row.name)).toEqual([
      "Book",
      "Chapter 1",
      "Notes",
      "Chapter 2",
    ]);
  });

  test("buildReport_example_cellsAddUpToEachRowAndTheGrandTotal", () => {
    const report = buildReport(exampleNodes());

    [...report.rows, { totals: report.inbox }].forEach(({ totals }) => {
      const cells = LOGGED_MODES.reduce(
        (sum, mode) => sum + totals.minutesByMode[mode],
        0,
      );
      expect(cells).toBe(totals.minutes);
    });
    const rootsAndInbox =
      report.rows.reduce((sum, row) => sum + row.totals.minutes, 0) +
      report.inbox.minutes;
    expect(rootsAndInbox).toBe(report.grand.minutes);
  });

  test("buildReport_example_grandAndInboxMatchTheSharedTotals", () => {
    const report = buildReport(exampleNodes());

    expect(report.grand).toEqual({
      minutes: exampleExpected.totals.minutes,
      minutesByMode: byModeFromJson(exampleExpected.totals.minutesByMode),
    });
    expect(report.inbox.minutes).toBe(exampleExpected.inbox.minutes);
    expect(report.loggedCycles).toBe(10);
  });

  test("buildReport_example_plannedVsActualMatchesTheSharedData", () => {
    expect(buildReport(exampleNodes()).plannedVsActual).toEqual(
      byModeFromJson(exampleExpected.plannedVsActual),
    );
  });

  test("buildReport_example_estimatesListOnlyEstimatedNodesWithOwnCounts", () => {
    expect(buildReport(exampleNodes()).estimates).toEqual([
      {
        nodeId: "00000000-0000-4000-8000-00000000000a",
        path: [],
        name: "Book",
        estimatedCycles: 5,
        doneCycles: 3,
      },
      {
        nodeId: "00000000-0000-4000-8000-00000000000b",
        path: ["Book"],
        name: "Chapter 1",
        estimatedCycles: 20,
        doneCycles: 2,
      },
      {
        nodeId: "00000000-0000-4000-8000-00000000000c",
        path: ["Book"],
        name: "Chapter 2",
        estimatedCycles: 15,
        doneCycles: 2,
      },
    ]);
  });

  test("buildReport_nodeWithNoTime_hasNoRow", () => {
    const names = buildReport(exampleNodes()).rows.map((row) => row.name);

    expect(names).not.toContain("Admin");
  });
});

describe("report text", () => {
  test.each([
    [4, 7, "+75%"],
    [10, 14, "+40%"],
    [8, 6, "-25%"],
    [5, 5, "0%"],
    [0, 3, undefined],
  ])("percentDifference_%s_%s_is%s", (expected, actual, text) => {
    expect(percentDifference(expected, actual)).toBe(text);
  });

  test("share_zeroWhole_isZero", () => {
    expect(share(0, 0)).toBe("0%");
    expect(share(125, 1505)).toBe("8%");
  });
});
