import { FocusMode } from "../gen/focusledger/v1/model_pb";
import type { ByMode, LoggedMode } from "../ledger/rollup";

/** The value of the `data-mode` attribute, which sets the mode's color in app.css. */
export const MODE_KEYS: ByMode<string> = {
  [FocusMode.DEEP_FOCUS]: "deep",
  [FocusMode.EXECUTION]: "execution",
  [FocusMode.SHALLOW]: "shallow",
};

export const MODE_DESCRIPTIONS: ByMode<string> = {
  [FocusMode.DEEP_FOCUS]:
    "One hard problem, held in your head. Designing, exploring, working it out for the first time.",
  [FocusMode.EXECUTION]:
    "You already know what to do and you are doing it. Building, writing it up, testing, fixing.",
  [FocusMode.SHALLOW]:
    "Keeping things moving. Email, tickets, replies, coordination, the chores that have to happen.",
};

export const MODE_SHORT_DESCRIPTIONS: ByMode<string> = {
  [FocusMode.DEEP_FOCUS]: "One hard problem.",
  [FocusMode.EXECUTION]: "You knew what to do.",
  [FocusMode.SHALLOW]: "Email, tickets, chores.",
};

export function modeKey(mode: FocusMode): string {
  return MODE_KEYS[mode as LoggedMode] ?? "execution";
}
