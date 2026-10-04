import type { SettingsPb } from "../gen/focusledger/v1/model_pb";
import type {
  BellSound,
  FocusSound,
  LocalSettings,
} from "../settings/localSettings";
import { startFocusSound } from "./focusSound";
import { type Playing, playRings } from "./sounds";

/** A cycle ran out (the bell), or a break ran out. */
export type BellEvent = "cycle" | "break";

export type NotificationState = NotificationPermission | "unsupported";

/** The browser parts the bell uses. Tests pass their own. */
export type BellDeps = {
  /** Rings `times` times. The result stops the rings still to come. */
  play: (sound: BellSound, volume: number, times: number) => Playing;
  /** Loops a focus sound until it is stopped. */
  focus: (sound: FocusSound, volume: number) => Playing;
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
 * Rings the bell "Ring N times" times. The sound follows Settings: Silent
 * plays nothing, and a break rings only with "Ring when a break ends". A cycle
 * also shows a notification when the tab is hidden and the browser allows it.
 * Returns the rings, so that a click can stop the rest.
 */
export function ringBell(
  event: BellEvent,
  settings: BellSettings,
  local: LocalSettings,
  message: { title: string; body: string },
  deps: BellDeps,
): Playing | undefined {
  const ringsForEvent = event === "cycle" || local.ringWhenBreakEnds;
  const rings =
    ringsForEvent && settings.soundEnabled && local.volume > 0
      ? deps.play(local.sound, local.volume, local.ringTimes)
      : undefined;
  if (
    event === "cycle" &&
    settings.notificationsEnabled &&
    deps.isHidden() &&
    deps.permission() === "granted"
  ) {
    deps.notify(message.title, message.body);
  }
  return rings;
}

const NOTHING: Playing = { stop: () => undefined };

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
  play: (sound, volume, times) => {
    const context = audioContext();
    return context ? playRings(context, sound, volume, times) : NOTHING;
  },
  focus: (sound, volume) => {
    const context = audioContext();
    return context ? startFocusSound(context, sound, volume) : NOTHING;
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
