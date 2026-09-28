import { useEffect, useRef } from "react";
import type { CyclePb } from "../gen/focusledger/v1/model_pb";
import { localTimeString } from "../ledger/period";
import type { LoggedMode } from "../ledger/rollup";
import { modeKey } from "../modes/modes";
import { MODE_NAMES } from "../today/todayModel";
import { PageHeader } from "../ui/PageHeader";
import { Pips } from "../ui/Pips";
import { useNow } from "../useNow";
import {
  elapsedMs,
  endTime,
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
          {formatCountdown(remainingMs(cycle, now))}
        </p>
        <div className="progress">
          <progress
            aria-label="Progress"
            value={Math.min(elapsedMs(cycle, now), plannedMs(cycle))}
            max={plannedMs(cycle)}
          />
          <div className="progress-figures">
            <span>
              {Math.min(elapsedMinutes, cycle.plannedMinutes)} of{" "}
              {cycle.plannedMinutes} min
            </span>
            <span>ends {localTimeString(endTime(cycle), timeZone)}</span>
          </div>
        </div>
        <p className="estimate-line">
          <Pips modes={doneModes} estimated={estimated} next={mode} />
          <span>{estimateLine}</span>
        </p>
      </section>
      <div className="focus-actions">
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
