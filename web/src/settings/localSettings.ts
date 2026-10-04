/**
 * The settings that SettingsPb has no field for (browser-v2 README, rule 6).
 * They live in this browser only, per device.
 */
export type BellSound = "bowl" | "wood" | "chime";

/** The background sound while a cycle runs. */
export type FocusSound =
  "none" | "tick-fast" | "tick-slow" | "white-noise" | "brown-noise";

export const FOCUS_SOUNDS: readonly FocusSound[] = [
  "none",
  "tick-fast",
  "tick-slow",
  "white-noise",
  "brown-noise",
];

export type LocalSettings = {
  longBreakMinutes: number;
  /** Long break after every Nth cycle. */
  longBreakEvery: number;
  /** The sound when SettingsPb.sound_enabled is on. Silent is sound_enabled off. */
  sound: BellSound;
  /** From 0 to 1. */
  volume: number;
  ringWhenBreakEnds: boolean;
  /** How many times the bell rings. */
  ringTimes: number;
  focusSound: FocusSound;
  /** From 0 to 1. */
  focusVolume: number;
};

export const LOCAL_DEFAULTS: LocalSettings = {
  longBreakMinutes: 15,
  longBreakEvery: 4,
  sound: "bowl",
  volume: 0.7,
  ringWhenBreakEnds: true,
  ringTimes: 3,
  focusSound: "none",
  focusVolume: 0.4,
};

export const LONG_BREAK_LENGTH = { min: 5, max: 120, step: 5 };
export const LONG_BREAK_EVERY = { min: 2, max: 12, step: 1 };
export const RING_TIMES = { min: 1, max: 5, step: 1 };

const KEY = "focus-ledger.settings";
const SOUNDS: readonly BellSound[] = ["bowl", "wood", "chime"];

// Browser storage can be missing, blocked, or hold an older shape. Each field
// that does not read back as valid falls back to its default.
export function loadLocalSettings(): LocalSettings {
  const stored = readStored();
  const inRange = (value: unknown, range: { min: number; max: number }) =>
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= range.min &&
    value <= range.max;
  const isVolume = (value: unknown): value is number =>
    typeof value === "number" && value >= 0 && value <= 1;
  return {
    longBreakMinutes: inRange(stored.longBreakMinutes, LONG_BREAK_LENGTH)
      ? (stored.longBreakMinutes as number)
      : LOCAL_DEFAULTS.longBreakMinutes,
    longBreakEvery: inRange(stored.longBreakEvery, LONG_BREAK_EVERY)
      ? (stored.longBreakEvery as number)
      : LOCAL_DEFAULTS.longBreakEvery,
    sound: SOUNDS.includes(stored.sound as BellSound)
      ? (stored.sound as BellSound)
      : LOCAL_DEFAULTS.sound,
    volume: isVolume(stored.volume) ? stored.volume : LOCAL_DEFAULTS.volume,
    ringWhenBreakEnds:
      typeof stored.ringWhenBreakEnds === "boolean"
        ? stored.ringWhenBreakEnds
        : LOCAL_DEFAULTS.ringWhenBreakEnds,
    ringTimes: inRange(stored.ringTimes, RING_TIMES)
      ? (stored.ringTimes as number)
      : LOCAL_DEFAULTS.ringTimes,
    focusSound: FOCUS_SOUNDS.includes(stored.focusSound as FocusSound)
      ? (stored.focusSound as FocusSound)
      : LOCAL_DEFAULTS.focusSound,
    focusVolume: isVolume(stored.focusVolume)
      ? stored.focusVolume
      : LOCAL_DEFAULTS.focusVolume,
  };
}

export function saveLocalSettings(settings: LocalSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    return;
  }
}

function readStored(): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
