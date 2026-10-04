import { useEffect, useRef, useState } from "react";

/**
 * The app's clock. Every tick sets `now` and calls `onTick` with the same
 * time, so the screens and the time-out check never disagree. It also ticks
 * once right after it starts, so a time-out that passed while the app was
 * closed fires at once.
 */
export function useClock(
  intervalMs: number,
  onTick: (now: Date) => void,
): Date {
  const [now, setNow] = useState(() => new Date());
  const latest = useRef(onTick);
  useEffect(() => {
    latest.current = onTick;
  });
  useEffect(() => {
    const tick = () => {
      const next = new Date();
      setNow(next);
      latest.current(next);
    };
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [intervalMs]);
  return now;
}
