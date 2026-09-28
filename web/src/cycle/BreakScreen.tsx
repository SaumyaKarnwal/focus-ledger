import { useEffect, useRef, useState } from "react";
import { PageHeader } from "../ui/PageHeader";
import { useNow } from "../useNow";
import { formatCountdown } from "./timer";

const MINUTE_MS = 60_000;
const EXTRA_BREAK_MINUTES = 5;

type Props = {
  breakMinutes: number;
  onDone: () => void;
};

/** A break is not written to the ledger (FR-5). */
export function BreakScreen({ breakMinutes, onDone }: Props) {
  const now = useNow();
  const [startedAt] = useState(() => Date.now());
  const [totalMinutes, setTotalMinutes] = useState(breakMinutes);
  const totalMs = totalMinutes * MINUTE_MS;
  const elapsedMs = Math.min(totalMs, Math.max(0, now.getTime() - startedAt));
  const remaining = totalMs - elapsedMs;
  const doneHandled = useRef(false);

  useEffect(() => {
    if (remaining === 0 && !doneHandled.current) {
      doneHandled.current = true;
      onDone();
    }
  }, [remaining, onDone]);

  return (
    <div className="focus-page" data-page="break">
      <PageHeader middle={<h2 className="label">Break</h2>} />
      <section className="focus-body" aria-label="Break">
        <p className="countdown" aria-label="Break time left" role="timer">
          {formatCountdown(remaining)}
        </p>
        <div className="progress">
          <progress
            aria-label="Break progress"
            value={elapsedMs}
            max={totalMs}
          />
          <div className="progress-figures">
            <span>
              {Math.floor(elapsedMs / MINUTE_MS)} of {totalMinutes} min
            </span>
          </div>
        </div>
      </section>
      <div className="focus-actions">
        <button
          type="button"
          className="button"
          onClick={() =>
            setTotalMinutes((minutes) => minutes + EXTRA_BREAK_MINUTES)
          }
        >
          +5 min
        </button>
        <button type="button" className="button-primary" onClick={onDone}>
          Skip and start
        </button>
      </div>
      <p className="break-note">Breaks are not logged. Only the work is.</p>
    </div>
  );
}
