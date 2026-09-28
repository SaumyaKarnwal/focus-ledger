import type { CyclePb } from "../gen/focusledger/v1/model_pb";
import { cycleStart } from "../ledger/rollup";

const MINUTE_MS = 60_000;

export function plannedMs(cycle: CyclePb): number {
  return cycle.plannedMinutes * MINUTE_MS;
}

export function elapsedMs(cycle: CyclePb, now: Date): number {
  return Math.max(0, now.getTime() - cycleStart(cycle).getTime());
}

export function remainingMs(cycle: CyclePb, now: Date): number {
  return Math.max(0, plannedMs(cycle) - elapsedMs(cycle, now));
}

export function endTime(cycle: CyclePb): Date {
  return new Date(cycleStart(cycle).getTime() + plannedMs(cycle));
}

export function hasEnded(cycle: CyclePb, now: Date): boolean {
  return remainingMs(cycle, now) === 0;
}

/** Whole minutes worked, from 1 to the planned minutes. A stop under 1 minute logs 1. */
export function minutesToLog(cycle: CyclePb, now: Date): number {
  const workedMs = Math.min(elapsedMs(cycle, now), plannedMs(cycle));
  return Math.max(1, Math.floor(workedMs / MINUTE_MS));
}

/** "mm:ss", or "h:mm:ss" from one hour. */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const minutesAndSeconds = `${pad(minutes)}:${pad(seconds)}`;
  return hours > 0 ? `${hours}:${minutesAndSeconds}` : minutesAndSeconds;
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
