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

/**
 * A parent the dialog creates on Create or Save, before the task. The key is
 * also its request_id. parentId is a node ID, another draft's key, or
 * undefined for the top.
 */
export type BranchDraft = { key: string; name: string; parentId?: string };

/** The parent is an existing node, a new branch, or none (the root). */
export type ParentChoice =
  | { kind: "root" }
  | { kind: "node"; nodeId: string }
  | { kind: "branch"; key: string };

export type TaskDraft = {
  name: string;
  parent: ParentChoice;
  /** The new branches, in the order they were added: parents come first. */
  branches: BranchDraft[];
  estimate: ByMode<EstimateRow>;
};

export type ParentRow = {
  /** The node ID, the new branch's key, or "adding" for the add field. */
  id: string;
  kind: "node" | "new" | "input";
  name: string;
  depth: number;
  /** Per ancestor level below the root: true where that level's line goes on down. */
  guides: boolean[];
  /** The last child of its parent: the line stops at this row. */
  last: boolean;
  minutes: number;
  path: string[];
};

type Child =
  | { kind: "node"; row: TreeRow }
  | { kind: "new"; branch: BranchDraft }
  | { kind: "input" };

/**
 * The open tasks as a tree, for the parent list. When editing, the task and
 * its subtree are left out, because a task cannot move under itself. Each
 * new branch shows as a child of its parent, after the existing children,
 * and the add field shows last under the row it adds to.
 */
export function parentRows(
  data: TodayData,
  editingId?: string,
  branches: readonly BranchDraft[] = [],
  addingUnder?: { parentId?: string },
): ParentRow[] {
  const nodes = knownNodes(data);
  const open = nodes.filter(
    (node) => !isClosedOrUnderClosed(node, nodes) && node.id !== editingId,
  );
  const childrenOf = (
    treeRows: readonly TreeRow[],
    parentId?: string,
  ): Child[] => [
    ...treeRows.map((row): Child => ({ kind: "node", row })),
    ...branches
      .filter((branch) => branch.parentId === parentId)
      .map((branch): Child => ({ kind: "new", branch })),
    ...(addingUnder !== undefined && addingUnder.parentId === parentId
      ? [{ kind: "input" } as const]
      : []),
  ];
  const rowsOf = (
    children: readonly Child[],
    depth: number,
    guides: boolean[],
    path: string[],
  ): ParentRow[] =>
    children.flatMap((child, index) => {
      const last = index === children.length - 1;
      const below = depth === 0 ? [] : [...guides, !last];
      const base = { depth, guides, last, path };
      if (child.kind === "input") {
        return [{ ...base, id: "adding", kind: "input", name: "", minutes: 0 }];
      }
      if (child.kind === "new") {
        const { key, name } = child.branch;
        return [
          { ...base, id: key, kind: "new", name, minutes: 0 },
          ...rowsOf(childrenOf([], key), depth + 1, below, [...path, name]),
        ];
      }
      const { node, rollUp, children: treeChildren } = child.row;
      return [
        {
          ...base,
          id: node.id,
          kind: "node",
          name: node.name,
          minutes: rollUp.rolledUp.minutes,
          path: child.row.path,
        },
        ...rowsOf(childrenOf(treeChildren, node.id), depth + 1, below, [
          ...child.row.path,
          node.name,
        ]),
      ];
    });
  return rowsOf(childrenOf(buildTree(open)), 0, [], []);
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
export function parentLabel(
  data: TodayData,
  parent: ParentChoice,
  branches: readonly BranchDraft[] = [],
): string {
  if (parent.kind === "root") return "None";
  const id = parent.kind === "node" ? parent.nodeId : parent.key;
  return pathTo(id, knownNodes(data), branches).join(" / ");
}

export function parentChoiceOf(node: NodePb | undefined): ParentChoice {
  return node?.parentId === undefined
    ? { kind: "root" }
    : { kind: "node", nodeId: node.parentId };
}

/** The names from the top down to the node or new branch with this ID. */
function pathTo(
  id: string,
  nodes: readonly NodePb[],
  branches: readonly BranchDraft[],
): string[] {
  const branch = branches.find((draft) => draft.key === id);
  if (branch) {
    const above =
      branch.parentId === undefined
        ? []
        : pathTo(branch.parentId, nodes, branches);
    return [...above, branch.name];
  }
  const node = nodes.find((listed) => listed.id === id);
  return node ? [...pathOf(node, nodes), node.name] : [];
}
