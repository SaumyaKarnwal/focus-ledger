import { useCallback, useState } from "react";

/** Runs one user action at a time and keeps its error for display. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run };
}
