import { useEffect, useRef } from "react";
import type { CyclePb } from "../gen/focusledger/v1/model_pb";
import type { LoggedMode } from "../ledger/rollup";
import { MODE_NAMES } from "../today/todayModel";
import { useNow } from "../useNow";
import {
  elapsedMs,
  endTime,
  formatClockTime,
  formatCountdown,
  hasEnded,
  minutesToLog,
  plannedMs,
  remainingMs,
} from "./timer";

type Props = {
  cycle: CyclePb;
  nodeName: string;
  path: string[];
  estimateLine: string;
  busy: boolean;
  onStop: (minutes: number) => void;
};

export function RunningScreen({
  cycle,
  nodeName,
  path,
  estimateLine,
  busy,
  onStop,
}: Props) {
  const now = useNow();
  const ended = hasEnded(cycle, now);
  const endHandled = useRef(false);

  useEffect(() => {
    if (ended && !endHandled.current) {
      endHandled.current = true;
      onStop(cycle.plannedMinutes);
    }
  }, [ended, cycle.plannedMinutes, onStop]);

  const minutes = minutesToLog(cycle, now);
  const elapsedMinutes = Math.floor(elapsedMs(cycle, now) / 60_000);

  return (
    <section aria-labelledby="running-heading">
      {path.length > 0 && <p aria-label="Breadcrumb">{path.join(" › ")}</p>}
      <h2 id="running-heading">{nodeName}</h2>
      <p>{MODE_NAMES[cycle.mode as LoggedMode]}</p>
      <p aria-label="Time left" role="timer">
        {formatCountdown(remainingMs(cycle, now))}
      </p>
      <progress
        aria-label="Progress"
        value={Math.min(elapsedMs(cycle, now), plannedMs(cycle))}
        max={plannedMs(cycle)}
      />
      <p>
        {Math.min(elapsedMinutes, cycle.plannedMinutes)} of{" "}
        {cycle.plannedMinutes} min · ends at {formatClockTime(endTime(cycle))}
      </p>
      <p>{estimateLine}</p>
      <button type="button" disabled={busy} onClick={() => onStop(minutes)}>
        Stop and log {minutes} min
      </button>
    </section>
  );
}
