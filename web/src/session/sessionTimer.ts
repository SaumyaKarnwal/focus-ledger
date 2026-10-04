import { loadLocalSettings } from "../settings/localSettings";

const MINUTE_MS = 60_000;

export type BreakKind = "short" | "long";

export const BREAK_NAMES: Record<BreakKind, string> = {
  short: "Short break",
  long: "Long break",
};

/** A break's choice and, once START is pressed, its start. It lives above the routes. */
export type BreakTimer = {
  kind: BreakKind;
  totalMinutes: number;
  startedAt?: number;
};

/** A break not started yet: the short break from the settings, or the long break from this browser. */
export function breakTimerFor(
  kind: BreakKind,
  breakMinutes: number,
): BreakTimer {
  return {
    kind,
    totalMinutes:
      kind === "short" ? breakMinutes : loadLocalSettings().longBreakMinutes,
  };
}

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
  /** "Deep Focus", or "Short break". */
  label: string;
  /** The time left, as "47:12". */
  text: string;
  /** deep, execution, shallow, or break: the mark color. */
  modeKey: string;
  onOpen: () => void;
};
