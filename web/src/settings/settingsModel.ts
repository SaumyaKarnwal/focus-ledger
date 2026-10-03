import type { SettingsPb } from "../gen/focusledger/v1/model_pb";

export type SettingsForm = Pick<
  SettingsPb,
  | "deepFocusMinutes"
  | "executionMinutes"
  | "shallowMinutes"
  | "breakMinutes"
  | "soundEnabled"
  | "notificationsEnabled"
>;

/** The update_mask path of each field (docs/api.md, UpdateSettings). */
export const SETTINGS_PATHS: Record<keyof SettingsForm, string> = {
  deepFocusMinutes: "deep_focus_minutes",
  executionMinutes: "execution_minutes",
  shallowMinutes: "shallow_minutes",
  breakMinutes: "break_minutes",
  soundEnabled: "sound_enabled",
  notificationsEnabled: "notifications_enabled",
};

/** The pause after the last change before the server write. */
export const SAVE_DELAY_MS = 600;

export const MODE_LENGTH = { min: 1, max: 480, step: 5 };
export const BREAK_LENGTH = { min: 1, max: 60, step: 1 };

export function toForm(settings: SettingsPb): SettingsForm {
  return {
    deepFocusMinutes: settings.deepFocusMinutes,
    executionMinutes: settings.executionMinutes,
    shallowMinutes: settings.shallowMinutes,
    breakMinutes: settings.breakMinutes,
    soundEnabled: settings.soundEnabled,
    notificationsEnabled: settings.notificationsEnabled,
  };
}

/** The mask paths of the fields that differ, in a fixed order (rule 7). */
export function changedPaths(
  before: SettingsForm,
  after: SettingsForm,
): string[] {
  return (Object.keys(SETTINGS_PATHS) as (keyof SettingsForm)[])
    .filter((key) => before[key] !== after[key])
    .map((key) => SETTINGS_PATHS[key]);
}
