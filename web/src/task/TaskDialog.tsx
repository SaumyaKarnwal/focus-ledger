import { create } from "@bufbuild/protobuf";
import { type FormEvent, type KeyboardEvent, useId, useState } from "react";
import { useRequestId } from "../api/useRequestId";
import { type NodePb, NodePbSchema } from "../gen/focusledger/v1/model_pb";
import { LOGGED_MODES, type LoggedMode } from "../ledger/rollup";
import { modeKey } from "../modes/modes";
import {
  ESTIMATE_COUNT,
  ESTIMATE_LENGTH,
  type EstimateRow,
  estimateRows,
  stepWithin,
} from "../tree/estimateModel";
import { formatMinutes, MODE_NAMES, type TodayData } from "../today/todayModel";
import { type TaskSave, taskSave } from "./saveTask";
import {
  type BranchDraft,
  filterParentRows,
  type ParentChoice,
  type ParentRow,
  parentChoiceOf,
  parentLabel,
  parentRows,
  type TaskDraft,
} from "./taskDialogModel";

type Props = {
  data: TodayData;
  /** The task to edit. Without it, the dialog creates a task. */
  editing?: NodePb;
  /** The parent a new task starts with. */
  initialParent?: ParentChoice;
  /** The writes. A rejection keeps the dialog open with the error. */
  onSave: (save: TaskSave) => Promise<NodePb | undefined>;
  onDone: (node: NodePb) => void;
  onClose: () => void;
};

/**
 * The New task and Edit task dialog (boards C-Desk-NewTask, -NewTask-Parent,
 * -Parent-Hover, -Parent-Add, and C-Desk-EditTask).
 */
export function TaskDialog({
  data,
  editing,
  initialParent,
  onSave,
  onDone,
  onClose,
}: Props) {
  const ids = useId();
  const [draft, setDraft] = useState<TaskDraft>(() => ({
    name: editing?.name ?? "",
    parent: editing
      ? parentChoiceOf(editing)
      : (initialParent ?? { kind: "root" }),
    estimate: estimateRows(editing ?? create(NodePbSchema), data.settings),
  }));
  const [choosingParent, setChoosingParent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const branchKey = useRequestId();
  const taskKey = useRequestId();
  const title = editing ? "Edit task" : "New task";
  const canSave = draft.name.trim() !== "" && !busy;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    setBusy(true);
    setError(undefined);
    try {
      const node = await onSave(
        taskSave(draft, editing, branchKey.requestIdFor, taskKey.requestIdFor),
      );
      branchKey.done();
      taskKey.done();
      if (node) onDone(node);
    } catch {
      setError("The task was not saved. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const setRow = (mode: LoggedMode, row: EstimateRow) =>
    setDraft((current) => ({
      ...current,
      estimate: { ...current.estimate, [mode]: row },
    }));

  return (
    <div
      className="picker-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      {choosingParent ? (
        <ParentChooser
          data={data}
          taskName={draft.name.trim()}
          editingId={editing?.id}
          parent={draft.parent}
          onPick={(parent) => {
            setDraft((current) => ({ ...current, parent }));
            setChoosingParent(false);
          }}
          onBack={() => setChoosingParent(false)}
        />
      ) : (
        <form
          className="task-dialog"
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onSubmit={(event) => void submit(event)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !busy) {
              event.preventDefault();
              onClose();
            }
          }}
        >
          <input
            className="task-dialog-name"
            aria-label="Task name"
            placeholder="Name the task"
            autoFocus
            value={draft.name}
            onChange={(event) =>
              setDraft((current) => ({ ...current, name: event.target.value }))
            }
          />
          <button
            type="button"
            className="task-dialog-parent"
            onClick={() => setChoosingParent(true)}
          >
            <span className="task-dialog-label">Parent</span>
            <span className="task-dialog-parent-path">
              {parentLabel(data, draft.parent)}
            </span>
            <Chevron />
          </button>
          <div
            className="task-dialog-estimate"
            role="group"
            aria-labelledby={`${ids}-estimate`}
          >
            <div className="task-dialog-estimate-head">
              <span id={`${ids}-estimate`} className="task-dialog-label">
                Estimate
              </span>
              <span className="task-dialog-hint">length × cycles</span>
            </div>
            {LOGGED_MODES.map((mode) => (
              <EstimateLine
                key={mode}
                mode={mode}
                row={draft.estimate[mode]}
                onChange={(row) => setRow(mode, row)}
              />
            ))}
          </div>
          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          <div className="task-dialog-actions">
            <button
              type="button"
              className="cancel-button"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="task-dialog-save"
              disabled={!canSave}
            >
              {editing ? "Save" : "Create"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function EstimateLine({
  mode,
  row,
  onChange,
}: {
  mode: LoggedMode;
  row: EstimateRow;
  onChange: (row: EstimateRow) => void;
}) {
  const name = MODE_NAMES[mode];
  return (
    <div className="task-estimate" data-mode={modeKey(mode)}>
      <span className="task-estimate-bar" aria-hidden="true" />
      <span className="task-estimate-name">{name}</span>
      <Stepper
        label={`${name} minutes per cycle`}
        value={row.cycleMinutes}
        less="5 minutes less"
        more="5 minutes more"
        onStep={(sign) =>
          onChange({
            ...row,
            cycleMinutes: stepWithin(
              row.cycleMinutes,
              sign * ESTIMATE_LENGTH.step,
              ESTIMATE_LENGTH,
            ),
          })
        }
      />
      <span className="task-estimate-unit">min</span>
      <span className="task-estimate-unit" aria-hidden="true">
        ×
      </span>
      <Stepper
        label={`${name} cycles`}
        value={row.cycleCount}
        less="One cycle less"
        more="One cycle more"
        narrow
        onStep={(sign) =>
          onChange({
            ...row,
            cycleCount: stepWithin(
              row.cycleCount,
              sign * ESTIMATE_COUNT.step,
              ESTIMATE_COUNT,
            ),
          })
        }
      />
    </div>
  );
}

function Stepper({
  label,
  value,
  less,
  more,
  narrow = false,
  onStep,
}: {
  label: string;
  value: number;
  less: string;
  more: string;
  narrow?: boolean;
  onStep: (sign: 1 | -1) => void;
}) {
  return (
    <span className="estimate-stepper" role="group" aria-label={label}>
      <button
        type="button"
        className="estimate-step"
        aria-label={`${label}: ${less}`}
        onClick={() => onStep(-1)}
      >
        −
      </button>
      <output
        className="estimate-value"
        data-narrow={narrow || undefined}
        aria-label={label}
      >
        {value}
      </output>
      <button
        type="button"
        className="estimate-step"
        aria-label={`${label}: ${more}`}
        onClick={() => onStep(1)}
      >
        +
      </button>
    </span>
  );
}

/** The parent list: None, then the open tasks as a tree. A row's "+" adds a branch under it. */
function ParentChooser({
  data,
  taskName,
  editingId,
  parent,
  onPick,
  onBack,
}: {
  data: TodayData;
  taskName: string;
  editingId?: string;
  parent: ParentChoice;
  onPick: (parent: ParentChoice) => void;
  onBack: () => void;
}) {
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState<BranchDraft>();
  const heldBranch = parent.kind === "branch" ? parent.branch : undefined;
  const rows = adding
    ? parentRows(data, editingId, adding)
    : filterParentRows(parentRows(data, editingId, heldBranch), query);

  const isPicked = (row: ParentRow) =>
    row.nodeId === undefined
      ? parent.kind === "branch"
      : parent.kind === "node" && parent.nodeId === row.nodeId;

  const escape = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (adding) setAdding(undefined);
    else onBack();
  };

  return (
    <section
      className="picker task-parent"
      role="dialog"
      aria-modal="true"
      aria-label="Choose a parent"
      onKeyDown={escape}
    >
      <label className="picker-search">
        <SearchIcon />
        <input
          aria-label="Search for a parent"
          placeholder={`Where does ${taskName || "this task"} belong?`}
          autoFocus
          value={query}
          disabled={adding !== undefined}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="task-parent-list">
        {(query.trim() === "" || adding) && (
          <div className="parent-row" data-none="true">
            <button
              type="button"
              className="parent-pick"
              aria-pressed={parent.kind === "root"}
              onClick={() => onPick({ kind: "root" })}
            >
              <span className="parent-name">None</span>
            </button>
          </div>
        )}
        {rows.map((row) =>
          row.nodeId === undefined && adding ? (
            <div key="adding" className="parent-row" data-adding="true">
              <Guides row={row} />
              <input
                className="parent-new-name"
                aria-label={`New task under ${row.path.at(-1) ?? "the top"}`}
                autoFocus
                value={adding.name}
                onChange={(event) =>
                  setAdding({ ...adding, name: event.target.value })
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter" && adding.name.trim() !== "") {
                    event.preventDefault();
                    onPick({ kind: "branch", branch: adding });
                  }
                }}
              />
            </div>
          ) : (
            <div key={row.nodeId ?? "branch"} className="parent-row">
              <button
                type="button"
                className="parent-pick"
                aria-pressed={isPicked(row)}
                onClick={() =>
                  onPick(
                    row.nodeId === undefined && heldBranch
                      ? { kind: "branch", branch: heldBranch }
                      : { kind: "node", nodeId: row.nodeId as string },
                  )
                }
              >
                {query.trim() === "" && <Guides row={row} />}
                <span className="parent-name">
                  {row.name}
                  {query.trim() !== "" && row.path.length > 0 && (
                    <span className="parent-path">
                      {" "}
                      · {row.path.join(" / ")}
                    </span>
                  )}
                </span>
                <span className="parent-time">
                  {row.minutes > 0 ? formatMinutes(row.minutes) : ""}
                </span>
              </button>
              {row.nodeId !== undefined && (
                <button
                  type="button"
                  className="parent-add"
                  aria-label={`Add a task under ${row.name}`}
                  onClick={() => {
                    setQuery("");
                    setAdding({ name: "", parentId: row.nodeId });
                  }}
                >
                  <PlusIcon />
                </button>
              )}
            </div>
          ),
        )}
      </div>
    </section>
  );
}

/** The tree lines: a pipe per open ancestor level, then the elbow to the row. */
function Guides({ row }: { row: ParentRow }) {
  if (row.depth === 0) return null;
  return (
    <>
      {row.guides.map((goesOn, index) => (
        <span
          key={index}
          className="parent-guide"
          data-line={goesOn || undefined}
          aria-hidden="true"
        />
      ))}
      <span
        className="parent-elbow"
        data-last={row.last || undefined}
        aria-hidden="true"
      />
    </>
  );
}

function Chevron() {
  return (
    <svg
      width="8"
      height="12"
      viewBox="0 0 9 13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1.5 1.5l5 5-5 5" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="7" cy="7" r="5" />
      <path d="M10.6 10.6L14 14" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M7 2v10M2 7h10" />
    </svg>
  );
}
