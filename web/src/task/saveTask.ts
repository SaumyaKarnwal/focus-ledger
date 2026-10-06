import type { Ledger } from "../api/ledger";
import { withRetry } from "../api/retry";
import type { EstimatePb, NodePb } from "../gen/focusledger/v1/model_pb";
import { toEstimates } from "../tree/estimateModel";
import type { TaskDraft } from "./taskDialogModel";

type Estimate = Pick<EstimatePb, "mode" | "cycleMinutes" | "cycleCount">;

/** The writes for one Create or Save. The request IDs stay the same on a retry. */
export type TaskSave = {
  /** The new branches, parents first. parentId is a node ID or an earlier branch's request ID. */
  branches: { requestId: string; name: string; parentId?: string }[];
  /** The task as the dialog opened it. Undefined for a new task. */
  editing?: NodePb;
  /** The task's request ID for a new task. A function, because the parent ID can come from a branch. */
  taskRequestId: (content: unknown) => string;
  name: string;
  /** A node ID, a branch's request ID, or undefined for the top. */
  parentId?: string;
  estimates: Estimate[];
};

export function taskSave(
  draft: TaskDraft,
  editing: NodePb | undefined,
  taskRequestId: (content: unknown) => string,
): TaskSave {
  const { parent } = draft;
  return {
    branches: draft.branches.map(({ key, name, parentId }) => ({
      requestId: key,
      name,
      parentId,
    })),
    editing,
    taskRequestId,
    name: draft.name.trim(),
    parentId:
      parent.kind === "node"
        ? parent.nodeId
        : parent.kind === "branch"
          ? parent.key
          : undefined,
    // A mode with no cycles has no estimate row.
    estimates: toEstimates(draft.estimate).filter((row) => row.cycleCount > 0),
  };
}

/** Creates the new branches in order, then creates or updates the task. Returns the task. */
export async function writeTask(
  client: Ledger,
  save: TaskSave,
  retryDelaysMs?: readonly number[],
): Promise<NodePb | undefined> {
  // A branch's request ID maps to the node the server created for it.
  const created = new Map<string, string>();
  const resolve = (id?: string) =>
    id === undefined ? id : (created.get(id) ?? id);
  for (const branch of save.branches) {
    const response = await withRetry(
      () =>
        client.createNode({
          requestId: branch.requestId,
          parentId: resolve(branch.parentId),
          name: branch.name,
        }),
      retryDelaysMs,
    );
    if (response.node) created.set(branch.requestId, response.node.id);
  }
  const parentId = resolve(save.parentId);
  const fields = { parentId, name: save.name, estimates: save.estimates };
  const editing = save.editing;
  if (editing !== undefined) {
    // Only the changed fields: a field another client changed meanwhile stays as it is.
    const paths = changedPaths(editing, fields);
    if (paths.length === 0) return editing;
    const response = await withRetry(
      () =>
        client.updateNode({
          nodeId: editing.id,
          ...fields,
          updateMask: { paths },
        }),
      retryDelaysMs,
    );
    return response.node;
  }
  const requestId = save.taskRequestId(fields);
  const response = await withRetry(
    () => client.createNode({ requestId, ...fields }),
    retryDelaysMs,
  );
  return response.node;
}

function changedPaths(
  node: NodePb,
  fields: { parentId?: string; name: string; estimates: Estimate[] },
): string[] {
  return [
    fields.name !== node.name && "name",
    fields.parentId !== node.parentId && "parent_id",
    estimateKey(fields.estimates) !== estimateKey(node.estimates) &&
      "estimates",
  ].filter((path): path is string => path !== false);
}

/** The estimate rows with cycles, in mode order, as one comparable string. */
function estimateKey(estimates: readonly Estimate[]): string {
  return estimates
    .filter((estimate) => estimate.cycleCount > 0)
    .map(
      ({ mode, cycleMinutes, cycleCount }) =>
        `${mode}:${cycleMinutes}x${cycleCount}`,
    )
    .sort()
    .join(",");
}
