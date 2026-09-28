import { create, enumFromJson } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { describe, expect, test } from "vitest";
import {
  CyclePbSchema,
  FocusMode,
  FocusModeSchema,
  NodePbSchema,
} from "../gen/focusledger/v1/model_pb";
import { exampleExpected, exampleNodes, exampleNow } from "./exampleData";
import { dayRange, weekRange } from "./period";
import {
  type ByMode,
  estimateProgress,
  inboxTotals,
  overallTotals,
  periodTotals,
  plannedVsActual,
  rollUpTree,
  runningCycle,
} from "./rollup";

function byModeFromJson<T>(json: Record<string, T>): ByMode<T> {
  return Object.fromEntries(
    Object.entries(json).map(([name, value]) => [
      enumFromJson(FocusModeSchema, name as "FOCUS_MODE_DEEP_FOCUS"),
      value,
    ]),
  ) as ByMode<T>;
}

function totalsFromJson(json: {
  minutes: number;
  minutesByMode: Record<string, number>;
}) {
  return {
    minutes: json.minutes,
    minutesByMode: byModeFromJson(json.minutesByMode),
  };
}

describe("rollUpTree", () => {
  test("rollUpTree_exampleTree_matchesOwnAndRolledUpFigures", () => {
    const rollUps = rollUpTree(exampleNodes());

    const expected = exampleExpected.tree.map((row) => [
      row.nodeId,
      {
        own: { ...row.own, ...totalsFromJson(row.own) },
        rolledUp: { ...row.rolledUp, ...totalsFromJson(row.rolledUp) },
      },
    ]);
    expect(rollUps).toEqual(new Map(expected as never));
  });

  test("rollUpTree_inboxNode_hasNoRow", () => {
    expect(rollUpTree(exampleNodes()).has("")).toBe(false);
  });

  test("rollUpTree_parentMissingFromList_countsNodeAsRoot", () => {
    const orphan = create(NodePbSchema, {
      id: "orphan",
      parentId: "closed-and-hidden",
      cycles: [loggedCycle(FocusMode.SHALLOW, 25)],
    });

    expect(rollUpTree([orphan]).get("orphan")?.rolledUp.minutes).toBe(25);
  });

  test("rollUpTree_prdExample_rollsUpCyclesAndEstimates", () => {
    const parent = create(NodePbSchema, {
      id: "parent",
      estimates: [
        { mode: FocusMode.DEEP_FOCUS, cycleMinutes: 90, cycleCount: 5 },
      ],
      cycles: repeat(3, () => loggedCycle(FocusMode.DEEP_FOCUS, 90)),
    });
    const child = create(NodePbSchema, {
      id: "child",
      parentId: "parent",
      estimates: [
        { mode: FocusMode.EXECUTION, cycleMinutes: 50, cycleCount: 35 },
      ],
      cycles: repeat(18, () => loggedCycle(FocusMode.EXECUTION, 50)),
    });

    const parentRollUp = rollUpTree([parent, child]).get("parent");

    expect(parentRollUp?.rolledUp.doneCycles).toBe(21);
    expect(parentRollUp?.rolledUp.estimatedCycles).toBe(40);
    expect(parentRollUp?.own.estimatedCycles).toBe(5);
  });
});

describe("totals", () => {
  test("overallTotals_exampleTree_includesInboxAndClosedNodes", () => {
    expect(overallTotals(exampleNodes())).toEqual(
      totalsFromJson(exampleExpected.totals),
    );
  });

  test("overallTotals_exampleTree_equalsRootsPlusInbox", () => {
    const nodes = exampleNodes();
    const rollUps = rollUpTree(nodes);
    const rootMinutes = nodes
      .filter((node) => node.id !== "" && node.parentId === undefined)
      .reduce(
        (sum, node) => sum + (rollUps.get(node.id)?.rolledUp.minutes ?? 0),
        0,
      );

    expect(rootMinutes + inboxTotals(nodes).minutes).toBe(
      overallTotals(nodes).minutes,
    );
  });

  test("inboxTotals_exampleTree_countsOnlyUnfiledCycles", () => {
    const inbox = inboxTotals(exampleNodes());

    expect({ doneCycles: inbox.doneCycles, minutes: inbox.minutes }).toEqual(
      exampleExpected.inbox,
    );
  });

  test.each(exampleExpected.periods.map((period) => [period.timeZone, period]))(
    "periodTotals_todayAndWeekIn%s_matchExpectedTotals",
    (timeZone, period) => {
      const nodes = exampleNodes();

      expect(periodTotals(nodes, dayRange(exampleNow, timeZone))).toEqual(
        totalsFromJson(period.todayTotals),
      );
      expect(periodTotals(nodes, weekRange(exampleNow, timeZone))).toEqual(
        totalsFromJson(period.weekTotals),
      );
    },
  );

  test("totalsOf_runningCycle_addsNoMinutes", () => {
    const running = create(NodePbSchema, {
      id: "running",
      cycles: [
        create(CyclePbSchema, {
          mode: FocusMode.EXECUTION,
          plannedMinutes: 50,
        }),
      ],
    });

    expect(overallTotals([running]).minutes).toBe(0);
    expect(rollUpTree([running]).get("running")?.own.doneCycles).toBe(0);
  });
});

describe("runningCycle", () => {
  test("runningCycle_exampleTree_returnsCycleWithNoMinutes", () => {
    expect(runningCycle(exampleNodes())?.id).toBe(
      exampleExpected.runningCycleId,
    );
  });

  test("runningCycle_allLogged_returnsUndefined", () => {
    const node = create(NodePbSchema, {
      id: "logged",
      cycles: [loggedCycle(FocusMode.SHALLOW, 25)],
    });

    expect(runningCycle([node])).toBeUndefined();
  });
});

describe("estimateProgress", () => {
  test("estimateProgress_exampleTree_countsOwnCyclesPerMode", () => {
    const nodesById = new Map(exampleNodes().map((node) => [node.id, node]));

    exampleExpected.estimateProgress.forEach(
      ({ nodeId, byMode, ...counts }) => {
        const node = nodesById.get(nodeId);
        expect(node && estimateProgress(node)).toEqual({
          ...counts,
          byMode: byModeFromJson(byMode),
        });
      },
    );
  });
});

describe("plannedVsActual", () => {
  test("plannedVsActual_exampleTree_sumsLoggedCyclesPerMode", () => {
    expect(plannedVsActual(exampleNodes())).toEqual(
      byModeFromJson(exampleExpected.plannedVsActual),
    );
  });
});

function loggedCycle(mode: FocusMode, minutes: number) {
  return create(CyclePbSchema, {
    mode,
    plannedMinutes: minutes,
    minutes,
    startedAt: timestampFromDate(exampleNow),
  });
}

function repeat<T>(count: number, make: () => T): T[] {
  return Array.from({ length: count }, make);
}
