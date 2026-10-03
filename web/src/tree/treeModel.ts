import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { NodePb } from "../gen/focusledger/v1/model_pb";
import { isInbox, type NodeRollUp, rollUpTree } from "../ledger/rollup";
import { formatMinutes } from "../today/todayModel";

export type TreeRow = {
  node: NodePb;
  rollUp: NodeRollUp;
  path: string[];
  children: TreeRow[];
};

/** The node tree with roll-ups. Siblings sort by creation time, then ID. */
export function buildTree(nodes: readonly NodePb[]): TreeRow[] {
  const treeNodes = nodes.filter((node) => !isInbox(node));
  const rollUps = rollUpTree(treeNodes);
  const byCreation = (left: NodePb, right: NodePb) =>
    createdAtMs(left) - createdAtMs(right) || left.id.localeCompare(right.id);
  const rowsUnder = (parentId: string | undefined, path: string[]): TreeRow[] =>
    treeNodes
      .filter((node) => node.parentId === parentId && rollUps.has(node.id))
      .sort(byCreation)
      .map((node) => ({
        node,
        rollUp: rollUps.get(node.id) as NodeRollUp,
        path,
        children: rowsUnder(node.id, [...path, node.name]),
      }));
  return rowsUnder(undefined, []);
}

/** The rows in display order, depth first. */
export function flattenTree(rows: readonly TreeRow[]): TreeRow[] {
  return rows.flatMap((row) => [row, ...flattenTree(row.children)]);
}

/** What a move of the row carries (FR-7.6), or undefined when it has no logged cycle. */
export function moveSummary(row: Pick<TreeRow, "rollUp">): string | undefined {
  const { doneCycles, minutes } = row.rollUp.rolledUp;
  if (doneCycles === 0) return undefined;
  const cycles = doneCycles === 1 ? "1 cycle" : `${doneCycles} cycles`;
  return `${cycles} · ${formatMinutes(minutes)} will move with it`;
}

function createdAtMs(node: NodePb): number {
  return node.createdAt ? timestampDate(node.createdAt).getTime() : 0;
}
