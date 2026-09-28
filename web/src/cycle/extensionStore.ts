/** An extension from the bell that runs but is not written yet. */
export type PendingExtension = {
  cycleId: string;
  startedAtMs: number;
  minutes: number;
  /** The cycle's minutes when the extension started. */
  loggedMinutes: number;
};

const STORAGE_KEY = "focus-ledger.extension";

// Browser storage can be missing or blocked. The extension then does not survive a reload.
export function saveExtension(extension: PendingExtension): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(extension));
  } catch {
    return;
  }
}

export function loadExtension(): PendingExtension | undefined {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? (JSON.parse(stored) as PendingExtension) : undefined;
  } catch {
    return undefined;
  }
}

export function clearExtension(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    return;
  }
}
