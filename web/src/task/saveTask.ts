import type { LedgerClient } from "../api/ledgerClient";
import { withRetry } from "../api/retry";
import type { EstimatePb, NodePb } from "../gen/focusledger/v1/model_pb";
import { toEstimates } from "../tree/estimateModel";
import type { BranchDraft, TaskDraft } from "./taskDialogModel";

type Estimate = Pick<EstimatePb, "mode" | "cycleMinutes" | "cycleCount">;

/** The writes for one Create or Save. The request IDs stay the same on a retry. */
export type TaskSave = {
  branch?: BranchDraft & { requestId: string };
  /** Undefined for a new task. */
  editingId?: string;
  /** The task's request ID for a new task. A function, because the parent ID can come from the branch. */
  taskRequestId: (content: unknown) => string;
  name: string;
  /** The existing parent, when there is no branch to create. */
  parentId?: string;
  estimates: Estimate[];
};

export function taskSave(
  draft: TaskDraft,
  editingId: string | undefined,
  branchRequestId: (content: unknown) => string,
  taskRequestId: (content: unknown) => string,
): TaskSave {
  const { parent } = draft;
  const branch =
    parent.kind === "branch"
      ? { ...parent.branch, name: parent.branch.name.trim() }
      : undefined;
  return {
    branch: branch && { ...branch, requestId: branchRequestId(branch) },
    editingId,
    taskRequestId,
    name: draft.name.trim(),
    parentId: parent.kind === "node" ? parent.nodeId : undefined,
    // A mode with no cycles has no estimate row.
    estimates: toEstimates(draft.estimate).filter((row) => row.cycleCount > 0),
  };
}

/** Creates the branch, if any, then creates or updates the task. Returns the task. */
export async function writeTask(
  client: LedgerClient,
  save: TaskSave,
  retryDelaysMs?: readonly number[],
): Promise<NodePb | undefined> {
  const branch = save.branch;
  const parentId = branch
    ? (
        await withRetry(
          () =>
            client.createNode({
              requestId: branch.requestId,
              parentId: branch.parentId,
              name: branch.name,
            }),
          retryDelaysMs,
        )
      ).node?.id
    : save.parentId;
  const fields = { parentId, name: save.name, estimates: save.estimates };
  const editingId = save.editingId;
  if (editingId !== undefined) {
    const response = await withRetry(
      () =>
        client.updateNode({
          nodeId: editingId,
          ...fields,
          updateMask: { paths: ["name", "parent_id", "estimates"] },
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
