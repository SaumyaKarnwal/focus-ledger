import type { CyclePb } from "../gen/focusledger/v1/model_pb";
import { cycleStart } from "../ledger/rollup";

const MINUTE_MS = 60_000;

export function plannedMs(cycle: CyclePb): number {
  return cycle.plannedMinutes * MINUTE_MS;
}

/** Worked time: the time since the start, less `pausedMs`. */
export function elapsedMs(cycle: CyclePb, now: Date, pausedMs = 0): number {
  return Math.max(0, now.getTime() - cycleStart(cycle).getTime() - pausedMs);
}

export function remainingMs(cycle: CyclePb, now: Date, pausedMs = 0): number {
  return Math.max(0, plannedMs(cycle) - elapsedMs(cycle, now, pausedMs));
}

export function endTime(cycle: CyclePb, pausedMs = 0): Date {
  return new Date(cycleStart(cycle).getTime() + plannedMs(cycle) + pausedMs);
}

export function hasEnded(cycle: CyclePb, now: Date, pausedMs = 0): boolean {
  return remainingMs(cycle, now, pausedMs) === 0;
}

/** Whole minutes worked, from 1 to the planned minutes. A stop under 1 minute logs 1. */
export function minutesToLog(cycle: CyclePb, now: Date, pausedMs = 0): number {
  const workedMs = Math.min(elapsedMs(cycle, now, pausedMs), plannedMs(cycle));
  return Math.max(1, Math.floor(workedMs / MINUTE_MS));
}

export type Extension = {
  startedAtMs: number;
  minutes: number;
  loggedMinutes: number;
};

export function extensionElapsedMs(extension: Extension, now: Date): number {
  return Math.min(
    extension.minutes * MINUTE_MS,
    Math.max(0, now.getTime() - extension.startedAtMs),
  );
}

export function extensionRemainingMs(extension: Extension, now: Date): number {
  return extension.minutes * MINUTE_MS - extensionElapsedMs(extension, now);
}

/** The cycle's new total: the logged minutes plus the whole extension minutes worked. */
export function extensionTotalMinutes(extension: Extension, now: Date): number {
  return (
    extension.loggedMinutes +
    Math.floor(extensionElapsedMs(extension, now) / MINUTE_MS)
  );
}

/** The paused time so far, and the start of the pause that is open now. */
export type PauseState = { totalMs: number; sinceMs?: number };

export function pausedMs(pause: PauseState, now: Date): number {
  return (
    pause.totalMs +
    (pause.sinceMs === undefined ? 0 : now.getTime() - pause.sinceMs)
  );
}

/** "mm:ss", with the minutes past 59 as they are ("90:00"), as the boards show. */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  return `${pad(Math.floor(totalSeconds / 60))}:${pad(totalSeconds % 60)}`;
}

export function formatClockTime(instant: Date): string {
  return instant.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
