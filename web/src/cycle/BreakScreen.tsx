import type { LoggedMode } from "../ledger/rollup";
import {
  BoundTask,
  ModePlate,
  ModeScreenFrame,
  ScreenClock,
} from "../start/ModeScreenFrame";
import { MODE_NAMES } from "../today/todayModel";
import { unlockAudio } from "../bell/bell";
import {
  BREAK_NAMES,
  type BreakKind,
  type BreakTimer,
  breakElapsedMs,
  breakRemainingMs,
  breakTimerFor,
} from "../session/sessionTimer";
import { formatCountdown } from "./timer";

const MINUTE_MS = 60_000;
const EXTRA_BREAK_MINUTES = 5;
const LENGTH_STEP = 5;
const LENGTH_MIN = 5;
const LENGTH_MAX = 120;

/** The cycle to come back to after the break. */
export type ComingBackTo = {
  mode: LoggedMode;
  /** Undefined for the Inbox. */
  taskName?: string;
  path: string[];
  /** The task to show on Start after the break, or undefined for the default task. */
  nodeId?: string;
};

type Props = {
  comingBackTo: ComingBackTo;
  /** The kind, the length, and the start live above the routes. */
  timer: BreakTimer;
  /** The short break length from the settings. */
  breakMinutes: number;
  email: string;
  timeZone: string;
  /** The app's clock. The time-out check above the routes uses the same one. */
  now: Date;
  onTimerChange: (timer: BreakTimer) => void;
  /** "Start a cycle": the break ends by hand. */
  onDone: () => void;
  onOpenTasks: () => void;
  onOpenSettings: () => void;
  onSignOut: () => void;
};

/** The break (boards C-Desk-Break2 and -Break2-Long). A break is not written to the ledger (FR-5). */
export function BreakScreen({
  comingBackTo,
  timer,
  breakMinutes,
  email,
  timeZone,
  now,
  onTimerChange,
  onDone,
  onOpenTasks,
  onOpenSettings,
  onSignOut,
}: Props) {
  const { kind, totalMinutes, startedAt } = timer;
  const totalMs = totalMinutes * MINUTE_MS;
  const elapsedMs = breakElapsedMs(timer, now);
  const remaining = breakRemainingMs(timer, now);

  const chooseKind = (next: BreakKind) =>
    onTimerChange(breakTimerFor(next, breakMinutes));
  const step = (by: number) =>
    onTimerChange({
      ...timer,
      totalMinutes: Math.min(
        LENGTH_MAX,
        Math.max(LENGTH_MIN, totalMinutes + by),
      ),
    });

  const backTo = comingBackTo.taskName
    ? [comingBackTo.taskName, comingBackTo.path.join(" / ")]
        .filter((part) => part !== "")
        .join(" · ")
    : "Not sure yet";

  return (
    <ModeScreenFrame
      modeKey="break"
      timeZone={timeZone}
      email={email}
      onOpenTasks={onOpenTasks}
      onOpenSettings={onOpenSettings}
      onSignOut={onSignOut}
      strip={
        <BoundTask
          label="Coming back to"
          name={MODE_NAMES[comingBackTo.mode]}
          detail={backTo}
        />
      }
    >
      {startedAt === undefined ? (
        <>
          <section className="start-modes" aria-labelledby="break-kind">
            <h2 id="break-kind" className="screen-label start-modes-label">
              What kind of break
            </h2>
            <div
              className="start-mode-list"
              role="radiogroup"
              aria-labelledby="break-kind"
            >
              {(["short", "long"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={kind === option}
                  className="start-mode"
                  onClick={() => chooseKind(option)}
                >
                  <span className="start-mode-bar" aria-hidden="true" />
                  <span className="start-mode-name">{BREAK_NAMES[option]}</span>
                </button>
              ))}
            </div>
          </section>
          <section className="start-clock" aria-label="Break length">
            <div className="start-stepper">
              <button
                type="button"
                className="start-step"
                aria-label="Shorter break"
                onClick={() => step(-LENGTH_STEP)}
              >
                −
              </button>
              <output className="start-time" aria-label="Break length">
                {formatCountdown(totalMs)}
              </output>
              <button
                type="button"
                className="start-step"
                aria-label="Longer break"
                onClick={() => step(LENGTH_STEP)}
              >
                +
              </button>
            </div>
            <div className="start-actions">
              <button
                type="button"
                className="screen-cta"
                aria-label="Start the break"
                onClick={() => {
                  unlockAudio();
                  onTimerChange({ ...timer, startedAt: now.getTime() });
                }}
              >
                START
              </button>
              <button
                type="button"
                className="screen-outline screen-outline-soft"
                onClick={() => onDone()}
              >
                Start a cycle
              </button>
            </div>
          </section>
        </>
      ) : (
        <>
          <ModePlate label="On a break" name={BREAK_NAMES[kind]} />
          <section className="start-clock" aria-label="Break">
            <ScreenClock
              label="Break time left"
              text={formatCountdown(remaining)}
              progress={elapsedMs / totalMs}
              note={
                <p className="screen-note">
                  {Math.floor(elapsedMs / MINUTE_MS)} of {totalMinutes} min.
                  Breaks are not logged.
                </p>
              }
            />
            <div className="start-actions">
              <button
                type="button"
                className="screen-outline"
                onClick={() =>
                  onTimerChange({
                    ...timer,
                    totalMinutes: totalMinutes + EXTRA_BREAK_MINUTES,
                  })
                }
              >
                +5 min
              </button>
              <button
                type="button"
                className="screen-outline screen-outline-soft"
                onClick={() => onDone()}
              >
                Start a cycle
              </button>
            </div>
          </section>
        </>
      )}
    </ModeScreenFrame>
  );
}
