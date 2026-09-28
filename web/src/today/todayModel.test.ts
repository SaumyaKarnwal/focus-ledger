import { create } from "@bufbuild/protobuf";
import { describe, expect, test } from "vitest";
import { NodePbSchema, SettingsPbSchema } from "../gen/focusledger/v1/model_pb";
import { exampleNodes, exampleNow } from "../ledger/exampleData";
import { weekRange } from "../ledger/period";
import { runningCycle } from "../ledger/rollup";
import {
  cycleContext,
  formatMinutes,
  formatRelative,
  INBOX_ID,
  selectedNode,
  type TodayData,
  todayModel,
} from "./todayModel";

function exampleData(): TodayData {
  const nodes = exampleNodes().filter((node) => !node.closed);
  return {
    settings: create(SettingsPbSchema),
    allTimeNodes: nodes,
    weekNodes: exampleNodes(),
    week: weekRange(exampleNow, "UTC"),
  };
}

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

  test("cycleContext_runningCycleOnEstimatedNode_statesNextCycleNumber", () => {
    const data = exampleData();
    const running = todayModel(data, exampleNow, "UTC").running!;

    expect(cycleContext(data, running)).toEqual({
      nodeName: "Notes",
      path: ["Book", "Chapter 1"],
      estimateLine: "No estimate for this mode",
    });
  });

  test("formatMinutes_values_useHoursAndMinutes", () => {
    expect([0, 45, 60, 150].map(formatMinutes)).toEqual([
      "0m",
      "45m",
      "1h",
      "2h 30m",
    ]);
  });

  test("formatRelative_thirtyMinutesAgo_isInMinutes", () => {
    expect(
      formatRelative(new Date(exampleNow.getTime() - 30 * 60_000), exampleNow),
    ).toBe("30 minutes ago");
  });
});
