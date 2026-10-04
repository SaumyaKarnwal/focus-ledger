import type { CyclePb } from "../gen/focusledger/v1/model_pb";
import type { LoggedMode } from "../ledger/rollup";
import { modeKey } from "../modes/modes";
import {
  BoundTask,
  ModePlate,
  ModeScreenFrame,
  ScreenClock,
} from "../start/ModeScreenFrame";
import { MODE_NAMES } from "../today/todayModel";
import {
  elapsedMs,
  formatCountdown,
  minutesToLog,
  type PauseState,
  pausedMs,
  plannedMs,
  remainingMs,
} from "./timer";

type Props = {
  cycle: CyclePb;
  /** "Inbox" for a cycle with no task. */
  nodeName: string;
  path: string[];
  email: string;
  timeZone: string;
  busy: boolean;
  /** The app's clock. The time-out check above the routes uses the same one. */
  now: Date;
  pause: PauseState;
  onTogglePause: () => void;
  onStop: (minutes: number) => void;
  onOpenTasks: () => void;
  onOpenSettings: () => void;
  onSignOut: () => void;
};

/**
 * The running cycle (board C-Desk-Run): the clock, PAUSE, and Stop and log.
 * The clock, the pause, and the time-out live above the routes, so they keep
 * going while another page shows.
 */
export function RunningScreen({
  cycle,
  nodeName,
  path,
  email,
  timeZone,
  busy,
  now,
  pause,
  onTogglePause,
  onStop,
  onOpenTasks,
  onOpenSettings,
  onSignOut,
}: Props) {
  const paused = pausedMs(pause, now);
  const isPaused = pause.sinceMs !== undefined;
  const minutes = minutesToLog(cycle, now, paused);
  const mode = cycle.mode as LoggedMode;
  const isInbox = nodeName === "Inbox";

  return (
    <ModeScreenFrame
      modeKey={modeKey(mode)}
      timeZone={timeZone}
      email={email}
      onOpenTasks={onOpenTasks}
      onOpenSettings={onOpenSettings}
      onSignOut={onSignOut}
      strip={
        <BoundTask
          name={isInbox ? "Not sure yet" : nodeName}
          detail={isInbox ? "name it later, or never" : path.join(" / ")}
        />
      }
    >
      <ModePlate label="Focus for this cycle" name={MODE_NAMES[mode]} />
      <section className="start-clock" aria-label="Cycle">
        <ScreenClock
          label="Time left"
          text={formatCountdown(remainingMs(cycle, now, paused))}
          progress={elapsedMs(cycle, now, paused) / plannedMs(cycle)}
          note={
            isPaused && (
              <p className="screen-note" role="status">
                Paused
              </p>
            )
          }
        />
        <div className="start-actions">
          <button
            type="button"
            className="screen-cta"
            aria-label={isPaused ? "Resume" : "Pause"}
            disabled={busy}
            onClick={onTogglePause}
          >
            {isPaused ? <PlayIcon /> : <PauseIcon />}
            {isPaused ? "RESUME" : "PAUSE"}
          </button>
          <button
            type="button"
            className="screen-outline"
            aria-label={`Stop and log ${minutes} min`}
            disabled={busy}
            onClick={() => onStop(minutes)}
          >
            Stop and log
          </button>
        </div>
      </section>
    </ModeScreenFrame>
  );
}

function PauseIcon() {
  return (
    <svg
      width="17"
      height="19"
      viewBox="0 0 12 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 2v10M8 2v10" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg
      width="15"
      height="17"
      viewBox="0 0 10 11"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M0 0l10 5.5L0 11z" />
    </svg>
  );
}
