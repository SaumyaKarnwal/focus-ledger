import { create } from "@bufbuild/protobuf";
import { describe, expect, test } from "vitest";
import {
  FocusMode,
  NodePbSchema,
  SettingsPbSchema,
} from "../gen/focusledger/v1/model_pb";
import { exampleNodes, exampleNow } from "../ledger/exampleData";
import { weekRange } from "../ledger/period";
import { runningCycle } from "../ledger/rollup";
import {
  cycleContext,
  formatMinutes,
  INBOX_ID,
  lastCycle,
  nextCycleLine,
  selectedNode,
  type TodayData,
  todayModel,
  todaySentence,
} from "./todayModel";

function exampleData(): TodayData {
  const nodes = exampleNodes().filter((node) => !node.closed);
  return {
    email: "fake.user@example.com",
    settings: create(SettingsPbSchema),
    allTimeNodes: nodes,
    weekNodes: exampleNodes(),
    week: weekRange(exampleNow, "UTC"),
  };
}

describe("lastCycle", () => {
  test("lastCycle_example_isTheLastLoggedCycle", () => {
    expect(lastCycle(exampleData())).toMatchObject({
      mode: FocusMode.EXECUTION,
      minutes: 50,
      nodeId: exampleNodes().find((node) => node.name === "Notes")?.id,
    });
  });

  test("lastCycle_newUser_isUndefined", () => {
    const data = { ...exampleData(), allTimeNodes: [], weekNodes: [] };

    expect(lastCycle(data)).toBeUndefined();
  });
});

describe("todayModel", () => {
  test("todayModel_example_sortsRailByLastCycleStart", () => {
    const model = todayModel(exampleData(), exampleNow, "UTC");

    expect(model.rail.map((row) => [row.name, row.worked])).toEqual([
      ["Notes", true],
      ["Book", true],
      ["Chapter 1", true],
      ["Admin", false],
    ]);
    expect(model.rail[0].path).toEqual(["Book", "Chapter 1"]);
  });

  test("todayModel_example_findsTheRunningCycleAndTheInboxCount", () => {
    const model = todayModel(exampleData(), exampleNow, "UTC");

    expect(model.running?.id).toBe(runningCycle(exampleNodes())?.id);
    expect(model.unfiledCycles).toBe(2);
  });

  test("selectedNode_inboxMissingFromList_isAnEmptyInbox", () => {
    const data = {
      ...exampleData(),
      allTimeNodes: [create(NodePbSchema, { id: "a", name: "A" })],
    };

    expect(selectedNode(data, INBOX_ID, exampleNow, "UTC")).toMatchObject({
      name: "Inbox",
      loggedToday: [],
    });
  });

  test("selectedNode_losAngeles_listsOnlyThatLocalDaysCycles", () => {
    const book = selectedNode(
      exampleData(),
      "00000000-0000-4000-8000-00000000000a",
      exampleNow,
      "America/Los_Angeles",
    );

    expect(book?.loggedToday).toEqual([]);
  });

  test("cycleContext_runningCycleOnUnestimatedNode_saysSo", () => {
    const data = exampleData();
    const running = todayModel(data, exampleNow, "UTC").running!;

    expect(cycleContext(data, running)).toEqual({
      nodeName: "Notes",
      path: ["Book", "Chapter 1"],
      estimateLine: "No estimate for this mode",
      doneModes: [FocusMode.EXECUTION],
      estimated: 0,
    });
  });

  test("cycleContext_pastTheEstimate_namesTheOrdinal", () => {
    const data = exampleData();
    const book = create(NodePbSchema, {
      id: "book",
      name: "Book",
      estimates: [
        { mode: FocusMode.EXECUTION, cycleMinutes: 50, cycleCount: 1 },
      ],
      cycles: [
        {
          nodeId: "book",
          mode: FocusMode.EXECUTION,
          plannedMinutes: 50,
          minutes: 50,
        },
        { nodeId: "book", mode: FocusMode.EXECUTION, plannedMinutes: 50 },
      ],
    });

    expect(
      cycleContext({ ...data, allTimeNodes: [book] }, book.cycles[1])
        .estimateLine,
    ).toBe("2nd cycle on a task estimated at 1");
  });

  test.each([
    [{ doneCycles: 3, estimatedCycles: 5 }, false, "Cycle 4 of 5"],
    [
      { doneCycles: 8, estimatedCycles: 8 },
      false,
      "The 9th here — one past the estimate",
    ],
    [{ doneCycles: 0, estimatedCycles: 0 }, false, "No estimate for this mode"],
    [{ doneCycles: 0, estimatedCycles: 0 }, true, "Goes to the Inbox"],
  ])("nextCycleLine_%j_inbox%s_is%s", (counts, inbox, expected) => {
    expect(nextCycleLine(counts, inbox)).toBe(expected);
  });

  test.each([
    [[], "Nothing logged yet today."],
    [[FocusMode.DEEP_FOCUS], "Your one cycle today was deep."],
    [
      [FocusMode.DEEP_FOCUS, FocusMode.DEEP_FOCUS, FocusMode.SHALLOW],
      "Two of your three cycles today were deep.",
    ],
    [
      [FocusMode.SHALLOW, FocusMode.SHALLOW],
      "All two of your cycles today were shallow.",
    ],
  ])("todaySentence_%j_is%s", (modes, expected) => {
    expect(todaySentence(modes as never)).toBe(expected);
  });

  test("formatMinutes_values_useHoursAndMinutes", () => {
    expect([0, 45, 60, 150].map(formatMinutes)).toEqual([
      "0m",
      "45m",
      "1h 00m",
      "2h 30m",
    ]);
  });
});
