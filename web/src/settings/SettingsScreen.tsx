import { type ReactNode, useState } from "react";
import type { LedgerClient } from "../api/ledgerClient";
import { withRetry } from "../api/retry";
import type { SettingsPb } from "../gen/focusledger/v1/model_pb";
import { LOGGED_MODES, type LoggedMode } from "../ledger/rollup";
import { modeKey, MODE_SHORT_DESCRIPTIONS } from "../modes/modes";
import { stepWithin } from "../tree/estimateModel";
import { MODE_NAMES } from "../today/todayModel";
import { PageHeader } from "../ui/PageHeader";
import { useAction } from "../useAction";
import {
  BREAK_LENGTH,
  changedPaths,
  MODE_LENGTH,
  type SettingsForm,
  toForm,
} from "./settingsModel";
import { FocusMode } from "../gen/focusledger/v1/model_pb";

const MODE_FIELDS: Record<LoggedMode, keyof SettingsForm> = {
  [FocusMode.DEEP_FOCUS]: "deepFocusMinutes",
  [FocusMode.EXECUTION]: "executionMinutes",
  [FocusMode.SHALLOW]: "shallowMinutes",
};

type Props = {
  client: LedgerClient;
  settings: SettingsPb;
  retryDelaysMs?: readonly number[];
  nav: ReactNode;
  /** Called after a save, or at once when nothing changed. */
  onDone: () => void;
  onSignOut: () => void;
};

/** FR-12.1: the three mode lengths, the break length, sound, and notifications. */
export function SettingsScreen({
  client,
  settings,
  retryDelaysMs,
  nav,
  onDone,
  onSignOut,
}: Props) {
  const saved = toForm(settings);
  const [form, setForm] = useState<SettingsForm>(saved);
  const { busy, error, run } = useAction();
  const paths = changedPaths(saved, form);

  const done = () => {
    if (paths.length === 0) {
      onDone();
      return;
    }
    void run(async () => {
      await withRetry(
        () => client.updateSettings({ settings: form, updateMask: { paths } }),
        retryDelaysMs,
      );
      onDone();
    });
  };

  const stepper = (
    key: keyof SettingsForm,
    label: string,
    range: { min: number; max: number; step: number },
  ) => (
    <span className="stepper">
      <button
        type="button"
        className="icon-button"
        aria-label={`Shorter ${label}`}
        onClick={() =>
          setForm({
            ...form,
            [key]: stepWithin(form[key] as number, -range.step, range),
          })
        }
      >
        −
      </button>
      <output aria-label={label}>{form[key] as number}</output>
      <button
        type="button"
        className="icon-button"
        aria-label={`Longer ${label}`}
        onClick={() =>
          setForm({
            ...form,
            [key]: stepWithin(form[key] as number, range.step, range),
          })
        }
      >
        +
      </button>
      <span className="stepper-unit">min</span>
    </span>
  );

  const toggle = (
    key: "soundEnabled" | "notificationsEnabled",
    label: string,
    note: string,
  ) => (
    <label className="toggle-row">
      <span className="toggle-text">
        <span className="mode-row-name">{label}</span>
        <span className="note">{note}</span>
      </span>
      <input
        type="checkbox"
        checked={form[key]}
        onChange={(event) => setForm({ ...form, [key]: event.target.checked })}
      />
    </label>
  );

  return (
    <>
      <PageHeader
        framed
        middle={nav}
        end={
          <button
            type="button"
            className="button button-small"
            disabled={busy}
            onClick={done}
          >
            Done
          </button>
        }
      />
      <div className="settings">
        <h2 className="title title-l">Settings</h2>
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        <div className="settings-grid">
          <section className="report-block" aria-labelledby="lengths">
            <h3 id="lengths" className="label report-block-head">
              Cycle length, minutes
            </h3>
            {LOGGED_MODES.map((mode) => (
              <div
                key={mode}
                className="settings-row"
                data-mode={modeKey(mode)}
              >
                <span className="mode-bar" aria-hidden="true" />
                <span className="mode-row-name">{MODE_NAMES[mode]}</span>
                {stepper(
                  MODE_FIELDS[mode],
                  `${MODE_NAMES[mode]} length`,
                  MODE_LENGTH,
                )}
                <span className="note">
                  {MODE_SHORT_DESCRIPTIONS[mode].toLowerCase()}
                </span>
              </div>
            ))}
            <p className="note">
              A change here sets what the next Start proposes. It never changes
              a cycle already written.
            </p>
          </section>
          <section className="report-block" aria-labelledby="breaks">
            <h3 id="breaks" className="label report-block-head">
              Break
            </h3>
            <div className="settings-row">
              <span className="mode-row-name">Break length</span>
              {stepper("breakMinutes", "Break length", BREAK_LENGTH)}
            </div>
            <p className="note">Breaks are not logged. Only the work is.</p>
          </section>
          <section className="report-block" aria-labelledby="alerts">
            <h3 id="alerts" className="label report-block-head">
              The bell
            </h3>
            {toggle(
              "soundEnabled",
              "Sound",
              "A sound when a cycle or a break ends",
            )}
            {toggle(
              "notificationsEnabled",
              "Notifications",
              "A browser notification when a cycle ends",
            )}
          </section>
        </div>
        <section
          className="report-block settings-account"
          aria-labelledby="account"
        >
          <h3 id="account" className="label report-block-head">
            Account
          </h3>
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={onSignOut}
          >
            Sign out
          </button>
        </section>
        <p className="note settings-foot">
          {paths.length === 0
            ? "No changes."
            : `${paths.length} ${paths.length === 1 ? "change" : "changes"} to save. Done saves them.`}
        </p>
      </div>
    </>
  );
}
