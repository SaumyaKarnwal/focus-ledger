import { describe, expect, test } from "vitest";
import { exampleNodes, exampleNow } from "../ledger/exampleData";
import { exampleNodesWithNothingRunning } from "../testing/appHarness";
import {
  canMoveUnder,
  findRow,
  formatAgo,
  formatUntaggedLatest,
  formatWhen,
  taskTree,
  untagged,
  visibleRows,
} from "./tasksModel";

const BOOK = "00000000-0000-4000-8000-00000000000a";
const CHAPTER_1 = "00000000-0000-4000-8000-00000000000b";
const NOTES = "00000000-0000-4000-8000-00000000000d";
const ADMIN = "00000000-0000-4000-8000-00000000000e";
const MINUTE_MS = 60_000;

function ago(minutes: number) {
  return new Date(exampleNow.getTime() - minutes * MINUTE_MS);
}

describe("Tasks model", () => {
  test("taskTree_rollsUpLoggedAndEstimateAndKeepsCompletedTasks", () => {
    const rows = visibleRows(
      taskTree(exampleNodesWithNothingRunning()),
      new Set(),
    );

    expect(
      rows.map(({ node, depth, logged, estimate, closed }) => [
        node.name,
        depth,
        logged,
        estimate,
        closed,
      ]),
    ).toEqual([
      ["Book", 0, 490, 1825, false],
      ["Chapter 1", 1, 160, 1000, false],
      ["Notes", 2, 50, undefined, false],
      ["Chapter 2", 1, 55, 375, true],
      ["Admin", 0, 0, undefined, false],
    ]);
  });

  test("taskTree_siblingsSortByLastWorkedNewestFirst", () => {
    const [book] = taskTree(exampleNodesWithNothingRunning());

    expect(book.lastWorked?.toISOString()).toBe("2026-11-01T09:30:00.000Z");
    expect(book.children.map((row) => row.node.name)).toEqual([
      "Chapter 1",
      "Chapter 2",
    ]);
  });

  test("visibleRows_collapsedRow_hidesItsSubtree", () => {
    const rows = visibleRows(
      taskTree(exampleNodesWithNothingRunning()),
      new Set([BOOK]),
    );

    expect(rows.map((row) => row.node.name)).toEqual(["Book", "Admin"]);
  });

  test("canMoveUnder_followsTheMoveRules", () => {
    const tree = taskTree(exampleNodesWithNothingRunning());
    const chapter1 = findRow(tree, CHAPTER_1);
    const admin = findRow(tree, ADMIN);
    const chapter2 = findRow(tree, "00000000-0000-4000-8000-00000000000c");
    if (!chapter1 || !admin || !chapter2) throw new Error("missing rows");

    expect(canMoveUnder(tree, chapter1, ADMIN)).toBe(true);
    expect(canMoveUnder(tree, chapter1, undefined)).toBe(true);
    expect(canMoveUnder(tree, chapter1, BOOK)).toBe(false);
    expect(canMoveUnder(tree, chapter1, NOTES)).toBe(false);
    expect(canMoveUnder(tree, admin, undefined)).toBe(false);
    expect(canMoveUnder(tree, admin, chapter2.node.id)).toBe(false);
    expect(canMoveUnder(tree, chapter2, ADMIN)).toBe(false);
  });

  test("untagged_listsTheLoggedInboxCyclesNewestFirst", () => {
    const group = untagged(exampleNodes());

    expect(group.cycles.map((cycle) => cycle.minutes)).toEqual([25, 50]);
    expect(group.minutes).toBe(75);
    expect(group.latest?.toISOString()).toBe("2026-11-01T07:30:00.000Z");
  });

  test.each([
    [0, "just now"],
    [12, "12 m ago"],
    [150, "2 h ago"],
    [21 * 60, "yesterday"],
    [4 * 24 * 60, "4 d ago"],
    [20 * 24 * 60, "2 w ago"],
  ])("formatAgo_%sMinutes_is%s", (minutes, expected) => {
    expect(formatAgo(ago(minutes), exampleNow, "UTC")).toBe(expected);
  });

  test("formatWhen_todayYesterdayAndOlder", () => {
    expect(formatWhen(ago(150), exampleNow, "UTC")).toBe("Today 17:30");
    expect(formatWhen(ago(21 * 60), exampleNow, "UTC")).toBe("Yesterday 23:00");
    expect(formatWhen(ago(12 * 24 * 60), exampleNow, "UTC")).toBe(
      "20 Oct 20:00",
    );
  });

  test("formatUntaggedLatest_isTheTimeTodayAndHowLongAgoBefore", () => {
    expect(formatUntaggedLatest(ago(150), exampleNow, "UTC")).toBe("17:30");
    expect(formatUntaggedLatest(ago(3 * 24 * 60), exampleNow, "UTC")).toBe(
      "3 d ago",
    );
  });
});
