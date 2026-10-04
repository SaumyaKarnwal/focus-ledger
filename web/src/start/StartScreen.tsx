import { type ReactNode, useState } from "react";
import { FocusMode, type NodePb } from "../gen/focusledger/v1/model_pb";
import { LOGGED_MODES, type LoggedMode } from "../ledger/rollup";
import { modeKey } from "../modes/modes";
import {
  INBOX_ID,
  knownNodes,
  lastCycle,
  taskAfterCycle,
  MODE_NAMES,
  plannedMinutesFor,
  type TodayData,
  todayModel,
} from "../today/todayModel";
import { useNow } from "../useNow";
import { ModeScreenFrame } from "./ModeScreenFrame";
import { taskStrip } from "./startModel";
import { TaskPicker } from "./TaskPicker";
import type { TaskSave } from "../task/saveTask";
import { TaskDialog } from "../task/TaskDialog";
import { parentChoiceOf } from "../task/taskDialogModel";

const LENGTH_STEP = 5;
const LENGTH_MIN = 5;
const LENGTH_MAX = 1440;

type Props = {
  data: TodayData;
  timeZone: string;
  busy: boolean;
  /** The task to show first, for example from "Open on Today" on the Tasks page. */
  initialNodeId?: string;
  initialMode?: LoggedMode;
  /** A dialog over the screen, such as the bell. The screen behind it takes no input. */
  overlay?: ReactNode;
  onStart: (nodeId: string, mode: LoggedMode, plannedMinutes: number) => void;
  onBreak: (nodeId: string, mode: LoggedMode) => void;
  /** Writes a task from the New task dialog and reloads the data. */
  onSaveTask: (save: TaskSave) => Promise<NodePb | undefined>;
  onOpenTasks?: () => void;
  onOpenSettings?: () => void;
  onSignOut: () => void;
};

/** The home screen (board C-Desk-Start): the whole screen takes the mode's color. */
export function StartScreen({
  data,
  timeZone,
  busy,
  initialNodeId,
  initialMode,
  overlay,
  onStart,
  onBreak,
  onSaveTask,
  onOpenTasks,
  onOpenSettings,
  onSignOut,
}: Props) {
  const now = useNow();
  // Start remembers the last cycle (README rule 11).
  const [first] = useState(() => {
    const last = lastCycle(data);
    const firstMode =
      initialMode ??
      (last?.mode as LoggedMode | undefined) ??
      FocusMode.DEEP_FOCUS;
    return {
      nodeId:
        initialNodeId ??
        (last && taskAfterCycle(data, last)) ??
        todayModel(data, now, timeZone).rail[0]?.nodeId ??
        INBOX_ID,
      mode: firstMode,
      minutes: plannedMinutesFor(data.settings, firstMode),
    };
  });
  const [nodeId, setNodeId] = useState(first.nodeId);
  const [mode, setMode] = useState<LoggedMode>(first.mode);
  const [minutes, setMinutes] = useState(first.minutes);
  const strip = taskStrip(data, nodeId);
  const [picking, setPicking] = useState(false);
  const [creating, setCreating] = useState(false);

  const chooseMode = (next: LoggedMode) => {
    setMode(next);
    setMinutes(plannedMinutesFor(data.settings, next));
  };
  const step = (by: number) =>
    setMinutes((current) =>
      Math.min(LENGTH_MAX, Math.max(LENGTH_MIN, current + by)),
    );

  return (
    <ModeScreenFrame
      modeKey={modeKey(mode)}
      timeZone={timeZone}
      email={data.email}
      onOpenTasks={onOpenTasks}
      onOpenSettings={onOpenSettings}
      onSignOut={onSignOut}
      inert={overlay !== undefined}
      strip={
        <>
          <button
            type="button"
            className="task-strip-task"
            aria-haspopup="dialog"
            onClick={() => setPicking(true)}
          >
            {strip ? (
              <>
                <span className="screen-label">Working on</span>
                <span className="task-strip-name">{strip.name}</span>
                {strip.path.length > 0 && (
                  <span className="task-strip-path">
                    {strip.path.join(" / ")}
                  </span>
                )}
              </>
            ) : (
              <span className="task-strip-empty">What are you working on?</span>
            )}
            <Chevron />
          </button>
          <span className="task-strip-time" data-testid="strip-time">
            {strip?.timeLine}
          </span>
        </>
      }
      overlay={
        (overlay ??
          (picking && (
            <TaskPicker
              data={data}
              now={now}
              timeZone={timeZone}
              currentNodeId={nodeId}
              onPick={(picked) => {
                setNodeId(picked);
                setPicking(false);
              }}
              onNewTask={() => {
                setPicking(false);
                setCreating(true);
              }}
              onClose={() => setPicking(false)}
            />
          ))) ||
        (creating && (
          <TaskDialog
            data={data}
            initialParent={parentChoiceOf(
              knownNodes(data).find((node) => node.id === nodeId),
            )}
            onSave={onSaveTask}
            onDone={(node) => {
              setNodeId(node.id);
              setCreating(false);
            }}
            onClose={() => setCreating(false)}
          />
        ))
      }
    >
      <section className="start-modes" aria-labelledby="focus-kind">
        <h2 id="focus-kind" className="screen-label start-modes-label">
          What kind of focus
        </h2>
        <div
          className="start-mode-list"
          role="radiogroup"
          aria-labelledby="focus-kind"
        >
          {LOGGED_MODES.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={mode === option}
              className="start-mode"
              onClick={() => chooseMode(option)}
            >
              <span className="start-mode-bar" aria-hidden="true" />
              <span className="start-mode-name">{MODE_NAMES[option]}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="start-clock" aria-label="Length">
        <div className="start-stepper">
          <button
            type="button"
            className="start-step"
            aria-label="Five minutes less"
            onClick={() => step(-LENGTH_STEP)}
          >
            −
          </button>
          <output className="start-time" aria-label="Length">
            {`${minutes}:00`}
          </output>
          <button
            type="button"
            className="start-step"
            aria-label="Five minutes more"
            onClick={() => step(LENGTH_STEP)}
          >
            +
          </button>
        </div>
        <div className="start-actions">
          <button
            type="button"
            className="screen-cta"
            aria-label="Start"
            disabled={busy}
            onClick={() => onStart(nodeId, mode, minutes)}
          >
            START
          </button>
          <button
            type="button"
            className="screen-outline"
            onClick={() => onBreak(nodeId, mode)}
          >
            Take a break
          </button>
        </div>
      </section>
    </ModeScreenFrame>
  );
}

function Chevron() {
  return (
    <svg
      width="9"
      height="14"
      viewBox="0 0 9 13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1.5 1.5l5 5-5 5" />
    </svg>
  );
}
