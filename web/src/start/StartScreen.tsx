import { useState } from "react";
import { FocusMode } from "../gen/focusledger/v1/model_pb";
import { LOGGED_MODES, type LoggedMode } from "../ledger/rollup";
import { modeKey } from "../modes/modes";
import {
  INBOX_ID,
  MODE_NAMES,
  plannedMinutesFor,
  type TodayData,
  todayModel,
} from "../today/todayModel";
import { useNow } from "../useNow";
import { ScreenHeader } from "./ScreenHeader";
import { taskStrip } from "./startModel";

const LENGTH_STEP = 5;
const LENGTH_MIN = 5;
const LENGTH_MAX = 1440;

type Props = {
  data: TodayData;
  timeZone: string;
  busy: boolean;
  /** The task to show first, for example from "Open on Today" on the Tasks page. */
  initialNodeId?: string;
  onStart: (nodeId: string, mode: LoggedMode, plannedMinutes: number) => void;
  onBreak: () => void;
  onPickTask: () => void;
  onOpenTasks: () => void;
  onSignOut: () => void;
};

/** The home screen (board C-Desk-Start): the whole screen takes the mode's color. */
export function StartScreen({
  data,
  timeZone,
  busy,
  initialNodeId,
  onStart,
  onBreak,
  onPickTask,
  onOpenTasks,
  onSignOut,
}: Props) {
  const now = useNow();
  const [nodeId] = useState(
    () =>
      initialNodeId ??
      todayModel(data, now, timeZone).rail[0]?.nodeId ??
      INBOX_ID,
  );
  const [mode, setMode] = useState<LoggedMode>(FocusMode.DEEP_FOCUS);
  const [minutes, setMinutes] = useState(() =>
    plannedMinutesFor(data.settings, FocusMode.DEEP_FOCUS),
  );
  const strip = taskStrip(data, nodeId);

  const chooseMode = (next: LoggedMode) => {
    setMode(next);
    setMinutes(plannedMinutesFor(data.settings, next));
  };
  const step = (by: number) =>
    setMinutes((current) =>
      Math.min(LENGTH_MAX, Math.max(LENGTH_MIN, current + by)),
    );

  return (
    <div className="mode-screen" data-mode={modeKey(mode)}>
      <div className="mode-screen-glow" aria-hidden="true" />
      <div className="mode-screen-body">
        <ScreenHeader
          now={now}
          timeZone={timeZone}
          email={data.email}
          onOpenTasks={onOpenTasks}
          onSignOut={onSignOut}
        />
        <div className="start-main">
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
                onClick={onBreak}
              >
                Take a break
              </button>
            </div>
          </section>
        </div>
        <footer className="task-strip">
          <button
            type="button"
            className="task-strip-task"
            onClick={onPickTask}
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
        </footer>
      </div>
    </div>
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
