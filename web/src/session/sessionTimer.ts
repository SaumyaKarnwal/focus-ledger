const MINUTE_MS = 60_000;

/** There is one kind of break. */
export const BREAK_NAME = "Break";

/** A break's length and, once START is pressed, its start. It lives above the routes. */
export type BreakTimer = {
  totalMinutes: number;
  startedAt?: number;
};

export function breakElapsedMs(timer: BreakTimer, now: Date): number {
  if (timer.startedAt === undefined) return 0;
  return Math.min(
    timer.totalMinutes * MINUTE_MS,
    Math.max(0, now.getTime() - timer.startedAt),
  );
}

export function breakRemainingMs(timer: BreakTimer, now: Date): number {
  return timer.totalMinutes * MINUTE_MS - breakElapsedMs(timer, now);
}

/** The header chip on other pages while a cycle runs or a break counts down. */
export type TimerChip = {
  /** "Deep Focus", or "Break". */
  label: string;
  /** The time left, as "47:12". */
  text: string;
  /** deep, execution, shallow, or break: the mark color. */
  modeKey: string;
  onOpen: () => void;
};
