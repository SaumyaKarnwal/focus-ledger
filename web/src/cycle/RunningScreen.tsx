import { useEffect, useRef, useState } from "react";
import type { CyclePb } from "../gen/focusledger/v1/model_pb";
import { localTimeString } from "../ledger/period";
import type { LoggedMode } from "../ledger/rollup";
import { modeKey } from "../modes/modes";
import { MODE_NAMES } from "../today/todayModel";
import { PageHeader } from "../ui/PageHeader";
import { Pips } from "../ui/Pips";
import { useNow } from "../useNow";
import { loadPause, savePause } from "./pauseStore";
import {
  elapsedMs,
  endTime,
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
  nodeName: string;
  path: string[];
  estimateLine: string;
  doneModes: LoggedMode[];
  estimated: number;
  timeZone: string;
  busy: boolean;
  onStop: (minutes: number) => void;
};

export function RunningScreen({
  cycle,
  nodeName,
  path,
  estimateLine,
  doneModes,
  estimated,
  timeZone,
  busy,
  onStop,
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

  const togglePause = () =>
    setPause((current) =>
      current.sinceMs === undefined
        ? { ...current, sinceMs: Date.now() }
        : { totalMs: current.totalMs + Date.now() - current.sinceMs },
    );

  const elapsedMinutes = Math.floor(elapsedMs(cycle, now, paused) / 60_000);
  const mode = cycle.mode as LoggedMode;

  return (
    <div className="focus-page">
      <PageHeader />
      <section className="focus-body" aria-labelledby="running-heading">
        <div className="focus-heading">
          {path.length > 0 && (
            <span className="crumb" aria-label="Breadcrumb">
              {path.join(" / ")}
            </span>
          )}
          <h2 id="running-heading" className="title title-l">
            {nodeName}
          </h2>
          <span className="mode-chip" data-mode={modeKey(mode)}>
            <span className="mode-bar" aria-hidden="true" />
            {MODE_NAMES[mode]}
          </span>
        </div>
        <p className="countdown" aria-label="Time left" role="timer">
          {formatCountdown(remainingMs(cycle, now, paused))}
        </p>
        <div className="progress">
          <progress
            aria-label="Progress"
            value={Math.min(elapsedMs(cycle, now, paused), plannedMs(cycle))}
            max={plannedMs(cycle)}
          />
          <div className="progress-figures">
            <span>
              {Math.min(elapsedMinutes, cycle.plannedMinutes)} of{" "}
              {cycle.plannedMinutes} min
            </span>
            <span>
              {isPaused
                ? "paused"
                : `ends ${localTimeString(endTime(cycle, paused), timeZone)}`}
            </span>
          </div>
        </div>
        {isPaused ? (
          <p className="estimate-line" role="status">
            Paused. After 10 minutes the cycle stops and logs {minutes} min.
          </p>
        ) : (
          <p className="estimate-line">
            <Pips modes={doneModes} estimated={estimated} next={mode} />
            <span>{estimateLine}</span>
          </p>
        )}
      </section>
      <div className="focus-actions">
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={togglePause}
        >
          {isPaused ? <PlayIcon /> : <PauseIcon />}
          {isPaused ? "Resume" : "Pause"}
        </button>
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => onStop(minutes)}
        >
          Stop and log {minutes} min
        </button>
      </div>
    </div>
  );
}

function PauseIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 2v8M8 2v8" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg
      width="12"
      height="13"
      viewBox="0 0 10 11"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M0 0l10 5.5L0 11z" />
    </svg>
  );
}
