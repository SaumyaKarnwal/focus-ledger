import { useEffect, useRef, useState } from "react";
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
import { useNow } from "../useNow";
import { loadPause, savePause } from "./pauseStore";
import {
  elapsedMs,
  formatCountdown,
  hasEnded,
  minutesToLog,
  type PauseState,
  pausedMs,
  pauseTooLong,
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
  onStop: (minutes: number) => void;
  onSignOut: () => void;
};

/** The running cycle (board C-Desk-Run): the clock, PAUSE, and Stop and log. */
export function RunningScreen({
  cycle,
  nodeName,
  path,
  email,
  timeZone,
  busy,
  onStop,
  onSignOut,
}: Props) {
  const now = useNow();
  // The server knows nothing of a pause. Browser storage keeps it over a reload.
  const [pause, setPause] = useState<PauseState>(
    () => loadPause(cycle.id) ?? { totalMs: 0 },
  );
  useEffect(() => {
    if (pause.totalMs > 0 || pause.sinceMs !== undefined)
      savePause(cycle.id, pause);
  }, [cycle.id, pause]);
  const paused = pausedMs(pause, now);
  const isPaused = pause.sinceMs !== undefined;
  const ended = !isPaused && hasEnded(cycle, now, paused);
  const tooLong = pauseTooLong(pause, now);
  const minutes = minutesToLog(cycle, now, paused);
  const endHandled = useRef(false);

  useEffect(() => {
    if (endHandled.current) return;
    if (ended) {
      endHandled.current = true;
      onStop(cycle.plannedMinutes);
    } else if (tooLong) {
      endHandled.current = true;
      onStop(minutes);
    }
  }, [ended, tooLong, minutes, cycle.plannedMinutes, onStop]);

  // The stamps use the clock that the countdown shows. With Date.now(), the two
  // clocks can differ by up to a second, and the countdown then jumps by one.
  const togglePause = () => {
    const at = now.getTime();
    setPause((current) =>
      current.sinceMs === undefined
        ? { ...current, sinceMs: at }
        : { totalMs: current.totalMs + at - current.sinceMs },
    );
  };

  const mode = cycle.mode as LoggedMode;
  const isInbox = nodeName === "Inbox";

  return (
    <ModeScreenFrame
      modeKey={modeKey(mode)}
      timeZone={timeZone}
      email={email}
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
                Paused. After 10 minutes the cycle stops and logs {minutes} min.
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
            onClick={togglePause}
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
