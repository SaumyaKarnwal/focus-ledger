import { useEffect, useState } from "react";
import { loadLocalSettings } from "../settings/localSettings";
import type { BellDeps } from "./bell";

/**
 * Plays the focus sound from Settings while `active` is true, and stops it
 * when `active` turns false or the screen goes away.
 */
export function useFocusSound(active: boolean, bell: BellDeps): void {
  const [{ focusSound, focusVolume }] = useState(loadLocalSettings);
  useEffect(() => {
    if (!active || focusSound === "none") return;
    const playing = bell.focus(focusSound, focusVolume);
    return () => playing.stop();
  }, [active, bell, focusSound, focusVolume]);
}
