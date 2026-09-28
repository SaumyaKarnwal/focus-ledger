import { create } from "@bufbuild/protobuf";
import {
  type Timestamp,
  timestampDate,
  timestampFromDate,
} from "@bufbuild/protobuf/wkt";
import {
  CyclePbSchema,
  type NodePb,
  NodePbSchema,
} from "../gen/focusledger/v1/model_pb";
import { exampleNodes, exampleNow } from "./exampleData";

/** The seed for the fake backend in the browser, from `?fixture=`. */
export type FixtureName =
  "today" | "running" | "ended" | "empty" | "signed-out";

const FIXTURES: readonly FixtureName[] = [
  "today",
  "running",
  "ended",
  "empty",
  "signed-out",
];
const MINUTE_MS = 60_000;

export function selectFixture(search: string): FixtureName {
  const requested = new URLSearchParams(search).get("fixture");
  return FIXTURES.find((name) => name === requested) ?? "today";
}

/**
 * The example rows, moved in time so that the example's "now" is `now`.
 * - today: nothing runs.
 * - running: the example's running cycle has 20 minutes left.
 * - ended: the running cycle's end time passed 10 minutes ago.
 * - empty: no nodes and no cycles, for the first run.
 * - signed-out: the today rows, behind the sign-in screen.
 */
export function fixtureNodes(name: FixtureName, now: Date): NodePb[] {
  switch (name) {
    case "empty":
      return [];
    case "today":
    case "signed-out":
      return withoutRunning(shiftToNow(exampleNodes(), exampleNow, now));
    case "running":
      return shiftToNow(exampleNodes(), exampleNow, now);
    case "ended":
      return shiftToNow(
        exampleNodes(),
        exampleNow,
        new Date(now.getTime() - 30 * MINUTE_MS),
      );
  }
}

/** Moves every start and creation time by `to - from`. */
export function shiftToNow(
  nodes: readonly NodePb[],
  from: Date,
  to: Date,
): NodePb[] {
  const offsetMs = to.getTime() - from.getTime();
  const shift = (timestamp: Timestamp | undefined) =>
    timestamp &&
    timestampFromDate(new Date(timestampDate(timestamp).getTime() + offsetMs));
  return nodes.map((node) =>
    create(NodePbSchema, {
      ...node,
      createdAt: shift(node.createdAt),
      cycles: node.cycles.map((cycle) =>
        create(CyclePbSchema, { ...cycle, startedAt: shift(cycle.startedAt) }),
      ),
    }),
  );
}

function withoutRunning(nodes: NodePb[]): NodePb[] {
  return nodes.map((node) =>
    create(NodePbSchema, {
      ...node,
      cycles: node.cycles.filter((cycle) => cycle.minutes !== undefined),
    }),
  );
}
