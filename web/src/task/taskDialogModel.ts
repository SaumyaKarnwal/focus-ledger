import type { NodePb } from "../gen/focusledger/v1/model_pb";
import type { ByMode } from "../ledger/rollup";
import type { EstimateRow } from "../tree/estimateModel";
import { buildTree, type TreeRow } from "../tree/treeModel";
import {
  isClosedOrUnderClosed,
  knownNodes,
  pathOf,
  type TodayData,
} from "../today/todayModel";

/** A parent the dialog creates on Create or Save, before the task under it. */
export type BranchDraft = { name: string; parentId?: string };

/** The parent is an existing node, the branch to create, or none (the root). */
export type ParentChoice =
  | { kind: "root" }
  | { kind: "node"; nodeId: string }
  | { kind: "branch"; branch: BranchDraft };

export type TaskDraft = {
  name: string;
  parent: ParentChoice;
  estimate: ByMode<EstimateRow>;
};

export type ParentRow = {
  /** Undefined for the branch to create. */
  nodeId?: string;
  name: string;
  depth: number;
  /** Per ancestor level below the root: true where that level's line goes on down. */
  guides: boolean[];
  /** The last child of its parent: the line stops at this row. */
  last: boolean;
  minutes: number;
  path: string[];
};

/**
 * The open tasks as a tree, for the parent list. When editing, the task and
 * its subtree are left out, because a task cannot move under itself. The
 * branch to create shows as the last child of its parent.
 */
export function parentRows(
  data: TodayData,
  editingId?: string,
  branch?: BranchDraft,
): ParentRow[] {
  const nodes = knownNodes(data);
  const open = nodes.filter(
    (node) => !isClosedOrUnderClosed(node, nodes) && node.id !== editingId,
  );
  const rowsOf = (
    rows: readonly TreeRow[],
    depth: number,
    guides: boolean[],
    parentId?: string,
  ): ParentRow[] => {
    const branchHere = branch !== undefined && branch.parentId === parentId;
    const count = rows.length + (branchHere ? 1 : 0);
    const nodeRows = rows.flatMap((row, index) => {
      const last = index === count - 1;
      return [
        {
          nodeId: row.node.id,
          name: row.node.name,
          depth,
          guides,
          last,
          minutes: row.rollUp.rolledUp.minutes,
          path: row.path,
        },
        ...rowsOf(
          row.children,
          depth + 1,
          depth === 0 ? [] : [...guides, !last],
          row.node.id,
        ),
      ];
    });
    if (!branchHere) return nodeRows;
    const parentPath =
      parentId === undefined ? [] : pathWithName(parentId, nodes);
    return [
      ...nodeRows,
      {
        name: branch.name,
        depth,
        guides,
        last: true,
        minutes: 0,
        path: parentPath,
      },
    ];
  };
  return rowsOf(buildTree(open), 0, []);
}

/** The rows whose name or path holds the query, ignoring case. */
export function filterParentRows(
  rows: readonly ParentRow[],
  query: string,
): ParentRow[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...rows];
  return rows.filter((row) =>
    [...row.path, row.name].join(" / ").toLowerCase().includes(needle),
  );
}

/** "Harbour / Backend", the path of the parent with its own name, or "None". */
export function parentLabel(data: TodayData, parent: ParentChoice): string {
  const nodes = knownNodes(data);
  if (parent.kind === "root") return "None";
  if (parent.kind === "node")
    return pathWithName(parent.nodeId, nodes).join(" / ");
  const above =
    parent.branch.parentId === undefined
      ? []
      : pathWithName(parent.branch.parentId, nodes);
  return [...above, parent.branch.name].join(" / ");
}

export function parentChoiceOf(node: NodePb | undefined): ParentChoice {
  return node?.parentId === undefined
    ? { kind: "root" }
    : { kind: "node", nodeId: node.parentId };
}

function pathWithName(nodeId: string, nodes: readonly NodePb[]): string[] {
  const node = nodes.find((listed) => listed.id === nodeId);
  return node ? [...pathOf(node, nodes), node.name] : [];
}
