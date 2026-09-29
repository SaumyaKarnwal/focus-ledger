import type { PauseState } from "./timer";

const KEY_PREFIX = "focus-ledger.pause.";

// Browser storage can be missing or blocked. The pause then lives in memory
// only, and a reload counts the paused time as work.
export function savePause(cycleId: string, pause: PauseState): void {
  try {
    localStorage.setItem(KEY_PREFIX + cycleId, JSON.stringify(pause));
  } catch {
    return;
  }
}

export function loadPause(cycleId: string): PauseState | undefined {
  try {
    const stored = localStorage.getItem(KEY_PREFIX + cycleId);
    return stored ? (JSON.parse(stored) as PauseState) : undefined;
  } catch {
    return undefined;
  }
}

export function clearPause(cycleId: string): void {
  try {
    localStorage.removeItem(KEY_PREFIX + cycleId);
  } catch {
    return;
  }
}
