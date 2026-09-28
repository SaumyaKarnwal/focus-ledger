import { useEffect, useRef, useState } from "react";
import { useNow } from "../useNow";
import { formatCountdown } from "./timer";

const MINUTE_MS = 60_000;
const EXTRA_BREAK_MINUTES = 5;

type Props = {
  breakMinutes: number;
  onDone: () => void;
};

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
    <section aria-labelledby="break-heading">
      <h2 id="break-heading">Break</h2>
      <p aria-label="Break time left" role="timer">
        {formatCountdown(remaining)}
      </p>
      <progress aria-label="Break progress" value={elapsedMs} max={totalMs} />
      <p>
        {Math.floor(elapsedMs / MINUTE_MS)} of {totalMinutes} min
      </p>
      <button
        type="button"
        onClick={() =>
          setTotalMinutes((minutes) => minutes + EXTRA_BREAK_MINUTES)
        }
      >
        +5 min
      </button>{" "}
      <button type="button" onClick={onDone}>
        Skip and start
      </button>
    </section>
  );
}
