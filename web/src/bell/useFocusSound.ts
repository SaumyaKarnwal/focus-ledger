import { useEffect } from "react";
import { loadLocalSettings } from "../settings/localSettings";
import type { BellDeps } from "./bell";

/**
 * Plays the focus sound from Settings while `active` is true, and stops it
 * when `active` turns false. It reads Settings each time it starts, so a
 * change in Settings applies from the next start.
 */
export function useFocusSound(active: boolean, bell: BellDeps): void {
  useEffect(() => {
    if (!active) return;
    const { focusSound, focusVolume } = loadLocalSettings();
    if (focusSound === "none") return;
    const playing = bell.focus(focusSound, focusVolume);
    return () => playing.stop();
  }, [active, bell]);
}
