import type { SettingsPb } from "../gen/focusledger/v1/model_pb";
import type { BellSound, LocalSettings } from "../settings/localSettings";
import { playSound } from "./sounds";

/** A cycle ran out (the bell), or a break ran out. */
export type BellEvent = "cycle" | "break";

export type NotificationState = NotificationPermission | "unsupported";

/** The browser parts the bell uses. Tests pass their own. */
export type BellDeps = {
  play: (sound: BellSound, volume: number) => void;
  notify: (title: string, body: string) => void;
  isHidden: () => boolean;
  permission: () => NotificationState;
  requestPermission: () => Promise<NotificationState>;
};

export type BellSettings = Pick<
  SettingsPb,
  "soundEnabled" | "notificationsEnabled"
>;

/**
 * Rings once. The sound follows Settings: Silent plays nothing, and a break
 * rings only with "Ring when a break ends". A cycle also shows a notification
 * when the tab is hidden and the browser allows it.
 */
export function ringBell(
  event: BellEvent,
  settings: BellSettings,
  local: LocalSettings,
  message: { title: string; body: string },
  deps: BellDeps,
): void {
  const ringsForEvent = event === "cycle" || local.ringWhenBreakEnds;
  if (ringsForEvent && settings.soundEnabled && local.volume > 0) {
    deps.play(local.sound, local.volume);
  }
  if (
    event === "cycle" &&
    settings.notificationsEnabled &&
    deps.isHidden() &&
    deps.permission() === "granted"
  ) {
    deps.notify(message.title, message.body);
  }
}

let sharedContext: AudioContext | undefined;

function audioContext(): AudioContext | undefined {
  if (typeof AudioContext === "undefined") return undefined;
  sharedContext ??= new AudioContext();
  return sharedContext;
}

/**
 * Browsers start audio only after a user gesture. START and the sound
 * buttons call this, so that the bell can play when a cycle runs out later.
 */
export function unlockAudio(): void {
  void audioContext()?.resume();
}

export const browserBell: BellDeps = {
  play: (sound, volume) => {
    const context = audioContext();
    if (context) playSound(context, sound, volume);
  },
  notify: (title, body) => {
    if (typeof Notification !== "undefined") new Notification(title, { body });
  },
  isHidden: () => document.visibilityState === "hidden",
  permission: () =>
    typeof Notification === "undefined"
      ? "unsupported"
      : Notification.permission,
  requestPermission: async () =>
    typeof Notification === "undefined"
      ? "unsupported"
      : Notification.requestPermission(),
};
