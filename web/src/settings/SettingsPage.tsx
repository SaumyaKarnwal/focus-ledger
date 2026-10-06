import { useCallback, useEffect, useRef, useState } from "react";
import type { Ledger } from "../api/ledger";
import { withRetry } from "../api/retry";
import { type BellDeps, unlockAudio } from "../bell/bell";
import type { Playing } from "../bell/sounds";
import { FocusMode } from "../gen/focusledger/v1/model_pb";
import type { LoggedMode } from "../ledger/rollup";
import { modeKey } from "../modes/modes";
import type { TimerChip } from "../session/sessionTimer";
import { ScreenHeader } from "../start/ScreenHeader";
import { MODE_NAMES, type TodayData } from "../today/todayModel";
import { stepWithin } from "../tree/estimateModel";
import { useNow } from "../useNow";
import { type SoundOption, SoundPicker } from "./SoundPicker";
import {
  BELL_SOUNDS,
  type BellSound,
  FOCUS_SOUNDS,
  type FocusSound,
  RING_TIMES,
  LONG_BREAK_LENGTH,
  type LocalSettings,
  loadLocalSettings,
  saveLocalSettings,
} from "./localSettings";
import {
  BREAK_LENGTH,
  changedPaths,
  MODE_LENGTH,
  SAVE_DELAY_MS,
  type SettingsForm,
  toForm,
} from "./settingsModel";

const MODE_FIELDS: readonly [LoggedMode, keyof SettingsForm][] = [
  [FocusMode.DEEP_FOCUS, "deepFocusMinutes"],
  [FocusMode.EXECUTION, "executionMinutes"],
  [FocusMode.SHALLOW, "shallowMinutes"],
];

/** The Silent choice of the bell sound: SettingsPb.sound_enabled is false. */
const SILENT = "silent";

/** How long a focus sound chip plays its sound. */
const FOCUS_PREVIEW_MS = 3000;

const FOCUS_NAMES: Record<FocusSound, string> = {
  none: "None",
  "tick-fast": "Ticking fast",
  "tick-slow": "Ticking slow",
  "white-noise": "White noise",
  "brown-noise": "Brown noise",
};

const SOUND_NAMES: Record<BellSound, string> = {
  bowl: "Bowl",
  wood: "Wood",
  chime: "Chime",
};

const BELL_OPTIONS: readonly SoundOption<BellSound | typeof SILENT>[] = [
  ...BELL_SOUNDS.map((sound) => ({ value: sound, label: SOUND_NAMES[sound] })),
  { value: SILENT, label: "Silent" },
];

const FOCUS_OPTIONS: readonly SoundOption<FocusSound>[] = FOCUS_SOUNDS.map(
  (sound) => ({ value: sound, label: FOCUS_NAMES[sound] }),
);

type Props = {
  client: Ledger;
  /** Plays the sound previews and asks for the notification permission. */
  bell: BellDeps;
  data: TodayData;
  timeZone: string;
  retryDelaysMs?: readonly number[];
  /** Called after a server write, so that Start uses the new lengths. */
  onSaved: () => void;
  onOpenStart: () => void;
  onOpenTasks: () => void;
  onOpenReport: () => void;
  onSignOut: () => void;
  /** While a cycle or break runs: the chip, and the brand goes back to it. */
  session?: { timer?: TimerChip; homeLabel: string };
};

/**
 * The Settings page (board H-Settings-Stacked). There is no Save button: a
 * change saves at once. SettingsPb fields go to the server, the rest to
 * browser storage (browser-v2 README, rule 6).
 */
export function SettingsPage({
  client,
  bell,
  data,
  timeZone,
  retryDelaysMs,
  onSaved,
  onOpenStart,
  onOpenTasks,
  onOpenReport,
  onSignOut,
  session,
}: Props) {
  const now = useNow(30_000);
  const [form, setForm] = useState<SettingsForm>(() => toForm(data.settings));
  const [local, setLocal] = useState<LocalSettings>(loadLocalSettings);
  const [error, setError] = useState<string>();
  const [notifyNote, setNotifyNote] = useState<string>();
  const saved = useRef<SettingsForm>(toForm(data.settings));
  const latest = useRef(form);
  useEffect(() => {
    latest.current = form;
  }, [form]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const flush = useCallback(async () => {
    timer.current = undefined;
    const draft = latest.current;
    const paths = changedPaths(saved.current, draft);
    if (paths.length === 0) return;
    try {
      await withRetry(
        () => client.updateSettings({ settings: draft, updateMask: { paths } }),
        retryDelaysMs,
      );
      saved.current = draft;
      setError(undefined);
      onSaved();
    } catch {
      setError("The change was not saved. Check the connection and try again.");
    }
  }, [client, retryDelaysMs, onSaved]);

  // Leaving the page sends a change that is still waiting.
  useEffect(
    () => () => {
      if (timer.current !== undefined) {
        clearTimeout(timer.current);
        void flush();
      }
    },
    [flush],
  );

  const change = (next: Partial<SettingsForm>) => {
    setForm((current) => ({ ...current, ...next }));
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
  };

  // Turning notifications on asks the browser first. A refusal keeps the switch off.
  const toggleNotifications = async () => {
    if (form.notificationsEnabled) {
      setNotifyNote(undefined);
      change({ notificationsEnabled: false });
      return;
    }
    const permission =
      bell.permission() === "default"
        ? await bell.requestPermission()
        : bell.permission();
    if (permission === "granted") {
      setNotifyNote(undefined);
      change({ notificationsEnabled: true });
    } else {
      setNotifyNote(
        permission === "unsupported"
          ? "This browser cannot show notifications."
          : "The browser blocks notifications for this site. Allow them in the browser settings, then turn this on.",
      );
    }
  };

  // A focus sound chip plays its sound for a few seconds. A new preview, or
  // leaving the page, stops the one before.
  const preview = useRef<{
    playing: Playing;
    timer: ReturnType<typeof setTimeout>;
  }>(undefined);
  const stopPreview = useCallback(() => {
    if (!preview.current) return;
    clearTimeout(preview.current.timer);
    preview.current.playing.stop();
    preview.current = undefined;
  }, []);
  useEffect(() => stopPreview, [stopPreview]);
  const previewFocus = (sound: FocusSound, volume: number) => {
    stopPreview();
    if (sound === "none") return;
    unlockAudio();
    const playing = bell.focus(sound, volume);
    preview.current = {
      playing,
      timer: setTimeout(stopPreview, FOCUS_PREVIEW_MS),
    };
  };

  const changeLocal = (next: Partial<LocalSettings>) => {
    const updated = { ...local, ...next };
    setLocal(updated);
    saveLocalSettings(updated);
  };

  return (
    <div className="tasks-page settings-page" data-surface="page">
      <ScreenHeader
        now={now}
        timeZone={timeZone}
        email={data.email}
        current="settings"
        onOpenHome={onOpenStart}
        onOpenTasks={onOpenTasks}
        onOpenReport={onOpenReport}
        onOpenSettings={() => {}}
        onSignOut={onSignOut}
        timer={session?.timer}
        homeLabel={session?.homeLabel}
      />
      <main className="settings-main">
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        <section className="settings-card" aria-labelledby="settings-cycles">
          <div className="settings-card-head">
            <h2 id="settings-cycles">Cycles</h2>
            <p>
              Where the clock starts. You can still change it before pressing
              Start.
            </p>
          </div>
          <h3 className="settings-group">Focus</h3>
          {MODE_FIELDS.map(([mode, field]) => (
            <SettingRow
              key={mode}
              label={MODE_NAMES[mode]}
              mark={modeKey(mode)}
            >
              <Stepper
                label={`${MODE_NAMES[mode]} minutes`}
                value={form[field] as number}
                unit="min"
                onStep={(sign) =>
                  change({
                    [field]: stepWithin(
                      form[field] as number,
                      sign * MODE_LENGTH.step,
                      MODE_LENGTH,
                    ),
                  })
                }
              />
            </SettingRow>
          ))}
          <h3 className="settings-group">Breaks</h3>
          <SettingRow label="Short break" mark="break">
            <Stepper
              label="Short break minutes"
              value={form.breakMinutes}
              unit="min"
              onStep={(sign) =>
                change({
                  breakMinutes: stepWithin(
                    form.breakMinutes,
                    sign * BREAK_LENGTH.step,
                    BREAK_LENGTH,
                  ),
                })
              }
            />
          </SettingRow>
          <SettingRow label="Long break" mark="break">
            <Stepper
              label="Long break minutes"
              value={local.longBreakMinutes}
              unit="min"
              onStep={(sign) =>
                changeLocal({
                  longBreakMinutes: stepWithin(
                    local.longBreakMinutes,
                    sign * LONG_BREAK_LENGTH.step,
                    LONG_BREAK_LENGTH,
                  ),
                })
              }
            />
          </SettingRow>
        </section>
        <section className="settings-card" aria-labelledby="settings-bell">
          <div className="settings-card-head">
            <h2 id="settings-bell">The bell</h2>
            <p>
              Plays when a cycle or break runs out. Nothing starts on its own.
            </p>
          </div>
          <SettingRow label="Sound" labelId="settings-sound">
            <SoundPicker
              labelId="settings-sound"
              options={BELL_OPTIONS}
              value={form.soundEnabled ? local.sound : SILENT}
              onPick={(choice) => {
                if (choice === SILENT) {
                  if (form.soundEnabled) change({ soundEnabled: false });
                  return;
                }
                // The pick is a user gesture, so the preview may play.
                unlockAudio();
                bell.play(choice, local.volume, 1);
                changeLocal({ sound: choice });
                if (!form.soundEnabled) change({ soundEnabled: true });
              }}
            />
          </SettingRow>
          <SettingRow label="Ring" labelId="settings-ring-times">
            <Stepper
              label="Ring times"
              value={local.ringTimes}
              unit="times"
              narrow
              onStep={(sign) =>
                changeLocal({
                  ringTimes: stepWithin(
                    local.ringTimes,
                    sign * RING_TIMES.step,
                    RING_TIMES,
                  ),
                })
              }
            />
          </SettingRow>
          <SettingRow label="Volume" labelId="settings-volume">
            <VolumeSlider
              labelId="settings-volume"
              value={local.volume}
              onChange={(volume) => changeLocal({ volume })}
            />
          </SettingRow>
          <SettingRow
            label="Show a notification when it rings"
            hint={notifyNote ?? "Even when Ekagra is in another tab"}
            labelId="settings-notify"
          >
            <Switch
              labelledBy="settings-notify"
              on={form.notificationsEnabled}
              onToggle={() => void toggleNotifications()}
            />
          </SettingRow>
          <SettingRow label="Ring when a break ends" labelId="settings-ring">
            <Switch
              labelledBy="settings-ring"
              on={local.ringWhenBreakEnds}
              onToggle={() =>
                changeLocal({ ringWhenBreakEnds: !local.ringWhenBreakEnds })
              }
            />
          </SettingRow>
        </section>
        <section className="settings-card" aria-labelledby="settings-focus">
          <div className="settings-card-head">
            <h2 id="settings-focus">Focus sound</h2>
            <p>Plays only while a cycle runs.</p>
          </div>
          <SettingRow label="Sound" labelId="settings-focus-sound">
            <SoundPicker
              labelId="settings-focus-sound"
              options={FOCUS_OPTIONS}
              value={local.focusSound}
              onPick={(sound) => {
                previewFocus(sound, local.focusVolume);
                changeLocal({ focusSound: sound });
              }}
            />
          </SettingRow>
          <SettingRow label="Volume" labelId="settings-focus-volume">
            <VolumeSlider
              labelId="settings-focus settings-focus-volume"
              value={local.focusVolume}
              onChange={(focusVolume) => changeLocal({ focusVolume })}
            />
          </SettingRow>
        </section>
      </main>
    </div>
  );
}

function SettingRow({
  label,
  hint,
  mark,
  labelId,
  children,
}: {
  label: string;
  hint?: string;
  /** A mode key or "break": draws the mark bar before the label. */
  mark?: string;
  labelId?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="settings-row" data-hint={hint !== undefined || undefined}>
      <span className="settings-label">
        {mark && (
          <span className="settings-mark" data-mode={mark} aria-hidden="true" />
        )}
        <span className="settings-label-text">
          <span id={labelId}>{label}</span>
          {hint && (
            <span className="settings-hint" aria-live="polite">
              {hint}
            </span>
          )}
        </span>
      </span>
      {children}
    </div>
  );
}

function Stepper({
  label,
  value,
  unit,
  narrow = false,
  onStep,
}: {
  label: string;
  value: number;
  unit: string;
  narrow?: boolean;
  onStep: (sign: 1 | -1) => void;
}) {
  return (
    <span className="settings-stepper">
      <span className="estimate-edit-stepper" role="group" aria-label={label}>
        <button
          type="button"
          aria-label={`${label}: less`}
          onClick={() => onStep(-1)}
        >
          −
        </button>
        <output aria-label={label} data-narrow={narrow || undefined}>
          {value}
        </output>
        <button
          type="button"
          aria-label={`${label}: more`}
          onClick={() => onStep(1)}
        >
          +
        </button>
      </span>
      <span className="settings-unit" data-wide={unit !== "min" || undefined}>
        {unit}
      </span>
    </span>
  );
}

function VolumeSlider({
  labelId,
  value,
  onChange,
}: {
  /** One or more element IDs, as aria-labelledby takes them. */
  labelId: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const percent = Math.round(value * 100);
  return (
    <span className="settings-volume">
      <SpeakerIcon />
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        aria-labelledby={labelId}
        value={percent}
        style={{ "--fill": `${percent}%` } as React.CSSProperties}
        onChange={(event) => onChange(Number(event.target.value) / 100)}
      />
    </span>
  );
}

function Switch({
  labelledBy,
  on,
  onToggle,
}: {
  labelledBy: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      className="settings-switch"
      aria-checked={on}
      aria-labelledby={labelledBy}
      onClick={onToggle}
    >
      <span aria-hidden="true" />
    </button>
  );
}

function SpeakerIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 6h3l4-3v10l-4-3H2z" />
    </svg>
  );
}
