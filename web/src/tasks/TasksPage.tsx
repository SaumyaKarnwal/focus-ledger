import { type DragEvent, useState } from "react";
import type { LedgerClient } from "../api/ledgerClient";
import { withRetry } from "../api/retry";
import type { CyclePb, NodePb } from "../gen/focusledger/v1/model_pb";
import { cycleStart, type LoggedMode } from "../ledger/rollup";
import { modeKey } from "../modes/modes";
import type { TimerChip } from "../session/sessionTimer";
import { ScreenHeader } from "../start/ScreenHeader";
import type { TaskSave } from "../task/saveTask";
import { TaskDialog } from "../task/TaskDialog";
import { TaskPage } from "../taskPage/TaskPage";
import { formatMinutes, MODE_NAMES, type TodayData } from "../today/todayModel";
import { useAction } from "../useAction";
import { useListNodes } from "../useListNodes";
import { useNow } from "../useNow";
import {
  canMoveUnder,
  findRow,
  formatAgo,
  formatUntaggedLatest,
  formatWhen,
  type TaskRow,
  taskTree,
  untagged,
  visibleRows,
} from "./tasksModel";

const UNTAGGED_SHOWN = 5;
const UNTAGGED_KEY = "untagged";
/** Hides the browser's own drag image: the page draws its own chip. */
const BLANK_IMAGE =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

type Props = {
  client: LedgerClient;
  data: TodayData;
  timeZone: string;
  retryDelaysMs?: readonly number[];
  onSaveTask: (save: TaskSave) => Promise<NodePb | undefined>;
  onOpenStart: () => void;
  onOpenReport: () => void;
  onOpenSettings: () => void;
  onSignOut: () => void;
  /** While a cycle or break runs: the chip, and the brand goes back to it. */
  session?: { timer?: TimerChip; homeLabel: string };
};

type Dragging =
  { kind: "task"; nodeId: string } | { kind: "cycle"; cycle: CyclePb };

/** The Tasks page (boards G-Tasks, -Hover, -Unfiled, -Drag, and -Empty). */
export function TasksPage({
  client,
  data,
  timeZone,
  retryDelaysMs,
  onSaveTask,
  onOpenStart,
  onOpenReport,
  onOpenSettings,
  onSignOut,
  session,
}: Props) {
  const now = useNow(30_000);
  // Completed tasks are listed too, muted.
  const { nodes, loadError, reload } = useListNodes(
    client,
    true,
    retryDelaysMs,
  );
  const { busy, error, run } = useAction();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () => new Set([UNTAGGED_KEY]),
  );
  const [allUntagged, setAllUntagged] = useState(false);
  const [dialog, setDialog] = useState<{ editing?: NodePb }>();
  const [openNodeId, setOpenNodeId] = useState<string>();
  const [dragging, setDragging] = useState<Dragging>();
  const [dropTarget, setDropTarget] = useState<string | null>();
  const [pointer, setPointer] = useState<{ x: number; y: number }>();

  const all = nodes ?? [];
  const tree = taskTree(all);
  const rows = visibleRows(tree, collapsed);
  const inbox = untagged(all);
  const openRow = findRow(tree, openNodeId);
  const draggedTask =
    dragging?.kind === "task" ? findRow(tree, dragging.nodeId) : undefined;

  const toggle = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const write = (call: () => Promise<unknown>) =>
    run(async () => {
      try {
        await withRetry(call, retryDelaysMs);
      } finally {
        reload();
      }
    });

  const moveTask = (row: TaskRow, parentId: string | undefined) =>
    void write(() =>
      client.updateNode({
        nodeId: row.node.id,
        parentId,
        updateMask: { paths: ["parent_id"] },
      }),
    );

  const fileCycle = (cycle: CyclePb, nodeId: string) =>
    void write(() =>
      client.updateCycle({
        cycleId: cycle.id,
        nodeId,
        updateMask: { paths: ["node_id"] },
      }),
    );

  const canDrop = (parentId: string | undefined) => {
    if (dragging?.kind === "cycle") {
      const target = findRow(tree, parentId);
      return target !== undefined && !target.closed;
    }
    return (
      draggedTask !== undefined && canMoveUnder(tree, draggedTask, parentId)
    );
  };

  const endDrag = () => {
    setDragging(undefined);
    setDropTarget(undefined);
    setPointer(undefined);
  };

  const dropOn = (parentId: string | undefined) => {
    const current = dragging;
    const moving = draggedTask;
    const allowed = canDrop(parentId);
    endDrag();
    if (!current || !allowed) return;
    if (current.kind === "cycle" && parentId !== undefined) {
      fileCycle(current.cycle, parentId);
      return;
    }
    // A drop moves at once, also when cycles move with the task (owner decision, #103).
    if (moving) moveTask(moving, parentId);
  };

  const startDrag = (event: DragEvent, next: Dragging) => {
    event.dataTransfer?.setData(
      "text/plain",
      next.kind === "task" ? next.nodeId : next.cycle.id,
    );
    if (event.dataTransfer?.setDragImage) {
      const image = new Image();
      image.src = BLANK_IMAGE;
      event.dataTransfer.setDragImage(image, 0, 0);
    }
    setDragging(next);
  };

  const dropProps = (parentId: string | undefined) => ({
    onDragOver: (event: DragEvent) => {
      if (!canDrop(parentId)) return;
      event.preventDefault();
      setDropTarget(parentId ?? null);
    },
    onDragLeave: () =>
      setDropTarget((current) =>
        current === (parentId ?? null) ? undefined : current,
      ),
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      dropOn(parentId);
    },
  });

  const inboxShown = allUntagged
    ? inbox.cycles
    : inbox.cycles.slice(0, UNTAGGED_SHOWN);
  const untaggedOpen = !collapsed.has(UNTAGGED_KEY);
  const noTasks = nodes !== undefined && tree.length === 0;

  return (
    <div className="tasks-page" data-surface="page">
      <ScreenHeader
        now={now}
        timeZone={timeZone}
        email={data.email}
        current="tasks"
        onOpenHome={onOpenStart}
        onOpenTasks={() => {}}
        onOpenReport={onOpenReport}
        onOpenSettings={onOpenSettings}
        onSignOut={onSignOut}
        timer={session?.timer}
        homeLabel={session?.homeLabel}
      />
      {openRow ? (
        <main className="tasks-main task-page-main">
          {(error || loadError) && (
            <p className="alert" role="alert">
              {error ?? loadError}
            </p>
          )}
          <TaskPage
            row={openRow}
            path={openRow.path}
            settings={data.settings}
            now={now}
            timeZone={timeZone}
            busy={busy}
            onBack={() => setOpenNodeId(undefined)}
            onEdit={() => setDialog({ editing: openRow.node })}
            onSetCompleted={(completed) =>
              void write(() =>
                client.updateNode({
                  nodeId: openRow.node.id,
                  closed: completed,
                  updateMask: { paths: ["closed"] },
                }),
              )
            }
            onSaveEstimate={(estimates) =>
              write(() =>
                client.updateNode({
                  nodeId: openRow.node.id,
                  estimates,
                  updateMask: { paths: ["estimates"] },
                }),
              )
            }
          />
        </main>
      ) : (
        <main className="tasks-main">
          <div className="tasks-bar">
            <button
              type="button"
              className="tasks-new"
              onClick={() => setDialog({})}
            >
              <PlusIcon />
              New task
            </button>
          </div>
          {(error || loadError) && (
            <p className="alert" role="alert">
              {error ?? loadError}
            </p>
          )}
          <section
            className="tasks-panel"
            aria-label="Tasks"
            data-empty={noTasks || undefined}
            onDragOver={(event) =>
              dragging && setPointer({ x: event.clientX, y: event.clientY })
            }
          >
            <div className="tasks-head" aria-hidden="true">
              <span className="tasks-col-name">Name</span>
              <span className="tasks-col">Logged</span>
              <span className="tasks-col">Estimate</span>
              <span className="tasks-col tasks-col-last">
                Last worked
                <SortIcon />
              </span>
              <span className="tasks-col-end" />
            </div>
            <ul className="tasks-rows" aria-label="Tasks">
              {draggedTask && draggedTask.node.parentId !== undefined && (
                <li
                  className="tasks-row tasks-top-zone"
                  data-drop-target={dropTarget === null}
                  {...dropProps(undefined)}
                >
                  Move to the top level
                </li>
              )}
              <li aria-label="Untagged" className="tasks-group">
                <div className="tasks-row" data-untagged="true">
                  <span className="tasks-col-name">
                    {inbox.cycles.length > 0 ? (
                      <button
                        type="button"
                        className="tasks-chevron"
                        aria-label={
                          untaggedOpen ? "Collapse Untagged" : "Expand Untagged"
                        }
                        aria-expanded={untaggedOpen}
                        onClick={() => toggle(UNTAGGED_KEY)}
                      >
                        <Chevron open={untaggedOpen} />
                      </button>
                    ) : (
                      <span className="tasks-chevron-space" />
                    )}
                    <span className="tasks-name-stack">
                      <span className="tasks-name">Untagged</span>
                      {noTasks && (
                        <span className="tasks-hint">
                          Cycles you run without picking a task land here.
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="tasks-col tasks-logged">
                    {formatMinutes(inbox.minutes)}
                  </span>
                  <span className="tasks-col" />
                  <span className="tasks-col tasks-col-last tasks-when">
                    {inbox.latest
                      ? formatUntaggedLatest(inbox.latest, now, timeZone)
                      : ""}
                  </span>
                  <span className="tasks-col-end" />
                </div>
                {untaggedOpen && (
                  <ul aria-label="Untagged cycles">
                    {inboxShown.map((cycle) => (
                      <li
                        key={cycle.id}
                        className="tasks-row tasks-cycle"
                        aria-label={`${MODE_NAMES[cycle.mode as LoggedMode]}, ${cycle.minutes} min`}
                        data-dragging={
                          dragging?.kind === "cycle" &&
                          dragging.cycle.id === cycle.id
                        }
                        draggable
                        onDragStart={(event) =>
                          startDrag(event, { kind: "cycle", cycle })
                        }
                        onDragEnd={endDrag}
                      >
                        <span className="tasks-col-name" data-depth="1">
                          <span className="tasks-chevron-space" />
                          <span
                            className="tasks-dot"
                            data-mode={modeKey(cycle.mode)}
                            aria-hidden="true"
                          />
                          <span className="tasks-cycle-mode">
                            {MODE_NAMES[cycle.mode as LoggedMode]}
                          </span>
                        </span>
                        <span className="tasks-col tasks-logged tasks-muted">
                          {cycle.minutes}m
                        </span>
                        <span className="tasks-col" />
                        <span className="tasks-col tasks-col-last tasks-when">
                          {formatWhen(cycleStart(cycle), now, timeZone)}
                        </span>
                        <span className="tasks-col-end">
                          <Grip />
                        </span>
                      </li>
                    ))}
                    {!allUntagged && inbox.cycles.length > UNTAGGED_SHOWN && (
                      <li className="tasks-row tasks-cycle">
                        <span className="tasks-col-name" data-depth="1">
                          <span className="tasks-chevron-space" />
                          <button
                            type="button"
                            className="tasks-older"
                            onClick={() => setAllUntagged(true)}
                          >
                            {inbox.cycles.length - UNTAGGED_SHOWN} older
                          </button>
                        </span>
                      </li>
                    )}
                  </ul>
                )}
              </li>
              {rows.map((row) => (
                <TaskLine
                  key={row.node.id}
                  row={row}
                  now={now}
                  timeZone={timeZone}
                  open={!collapsed.has(row.node.id)}
                  dragging={
                    dragging?.kind === "task" && dragging.nodeId === row.node.id
                  }
                  dropTarget={dropTarget === row.node.id}
                  onToggle={() => toggle(row.node.id)}
                  onOpen={() => setOpenNodeId(row.node.id)}
                  onDragStart={(event) =>
                    startDrag(event, { kind: "task", nodeId: row.node.id })
                  }
                  onDragEnd={endDrag}
                  dropProps={row.closed ? {} : dropProps(row.node.id)}
                />
              ))}
            </ul>
            {noTasks && (
              <div className="tasks-empty">
                <p className="tasks-empty-title">No tasks yet</p>
                <p className="tasks-empty-text">
                  Use New task above. Each task gets a row here, with the time
                  you log against it and how that compares to your estimate.
                </p>
              </div>
            )}
            {nodes === undefined && !loadError && (
              <p className="tasks-empty-text">Loading…</p>
            )}
          </section>
        </main>
      )}
      {dragging && pointer && (
        <span
          className="tasks-drag-chip"
          style={{ left: pointer.x + 14, top: pointer.y + 10 }}
          aria-hidden="true"
        >
          {dragging.kind === "cycle" ? (
            <>
              <span
                className="tasks-dot"
                data-mode={modeKey(dragging.cycle.mode)}
              />
              <span>{MODE_NAMES[dragging.cycle.mode as LoggedMode]}</span>
              <span className="tasks-muted">{dragging.cycle.minutes}m</span>
            </>
          ) : (
            <span>{draggedTask?.node.name}</span>
          )}
        </span>
      )}
      {dialog && (
        <TaskDialog
          data={data}
          editing={dialog.editing}
          onSave={async (save) => {
            const node = await onSaveTask(save);
            reload();
            return node;
          }}
          onDone={() => setDialog(undefined)}
          onClose={() => setDialog(undefined)}
        />
      )}
    </div>
  );
}

function TaskLine({
  row,
  now,
  timeZone,
  open,
  dragging,
  dropTarget,
  onToggle,
  onOpen,
  onDragStart,
  onDragEnd,
  dropProps,
}: {
  row: TaskRow;
  now: Date;
  timeZone: string;
  open: boolean;
  dragging: boolean;
  dropTarget: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onDragStart: (event: DragEvent) => void;
  onDragEnd: () => void;
  dropProps: object;
}) {
  const { node, depth, logged, estimate, lastWorked, closed } = row;
  const hasChildren = row.children.length > 0;
  return (
    <li
      aria-label={node.name}
      className="tasks-row"
      data-top={depth === 0}
      data-closed={closed || undefined}
      data-dragging={dragging}
      data-drop-target={dropTarget}
      draggable={!closed}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      {...dropProps}
    >
      <span
        className="tasks-col-name"
        style={{ paddingLeft: `${depth * 24}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="tasks-chevron"
            aria-label={`${open ? "Collapse" : "Expand"} ${node.name}`}
            aria-expanded={open}
            onClick={(event) => {
              event.stopPropagation();
              onToggle();
            }}
          >
            <Chevron open={open} />
          </button>
        ) : (
          <span className="tasks-chevron-space" />
        )}
        <button
          type="button"
          className="tasks-name"
          data-top={depth === 0}
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
        >
          {node.name}
        </button>
        {closed && <span className="tasks-hint">Completed</span>}
      </span>
      <span className="tasks-col tasks-logged">
        {logged > 0 ? formatMinutes(logged) : ""}
      </span>
      <span className="tasks-col">
        {estimate !== undefined && (
          <span
            className="tasks-estimate"
            data-over={logged > estimate || undefined}
          >
            {formatMinutes(estimate)}
          </span>
        )}
      </span>
      <span className="tasks-col tasks-col-last tasks-when">
        {lastWorked ? formatAgo(lastWorked, now, timeZone) : ""}
      </span>
      <span className="tasks-col-end">{!closed && <Grip />}</span>
    </li>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={open ? "M3.5 6l4.5 4.5L12.5 6" : "M6 3.5l4.5 4.5L6 12.5"} />
    </svg>
  );
}

function Grip() {
  return (
    <svg
      className="tasks-grip"
      width="9"
      height="14"
      viewBox="0 0 10 16"
      fill="currentColor"
      aria-hidden="true"
    >
      {[2, 8, 14].flatMap((y) =>
        [2, 8].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.5" />),
      )}
    </svg>
  );
}

function SortIcon() {
  return (
    <svg
      width="9"
      height="6"
      viewBox="0 0 10 7"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1 1.5l4 4 4-4" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M7 2v10M2 7h10" />
    </svg>
  );
}
