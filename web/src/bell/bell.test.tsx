import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "../App";
import type { LedgerClient } from "../api/ledgerClient";
import { exampleNow } from "../ledger/exampleData";
import {
  LOCAL_DEFAULTS,
  type LocalSettings,
  loadLocalSettings,
  saveLocalSettings,
} from "../settings/localSettings";
import {
  exampleNodesWithNothingRunning,
  recordingClient,
} from "../testing/appHarness";
import { fakeBell } from "../testing/fakeBell";
import { openFromTasks, startCycleOn } from "../testing/navigation";
import { pickSound, soundPicker } from "../testing/soundPicker";
import { ringBell } from "./bell";
import { playSound, type SoundContext } from "./sounds";

const MINUTE_MS = 60_000;
const MESSAGE = { title: "Ekagra: Deep Focus cycle done", body: "Book" };
const ON = { soundEnabled: true, notificationsEnabled: true };

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(exampleNow);
});

afterEach(() => {
  vi.useRealTimers();
});

function ring(
  event: "cycle" | "break",
  settings = ON,
  local: Partial<LocalSettings> = {},
  hidden = false,
  permission: "granted" | "denied" | "default" = "granted",
) {
  const bell = fakeBell(permission);
  bell.setHidden(hidden);
  ringBell(
    event,
    settings,
    { ...LOCAL_DEFAULTS, ...local },
    MESSAGE,
    bell.deps,
  );
  return bell;
}

describe("Bell rules", () => {
  test("ring_cycle_playsTheChosenSoundAtTheVolume", () => {
    expect(ring("cycle", ON, { sound: "wood", volume: 0.4 }).played).toEqual([
      ["wood", 0.4, 3],
    ]);
  });

  test("ring_silent_playsNothing", () => {
    expect(ring("cycle", { ...ON, soundEnabled: false }).played).toEqual([]);
  });

  test("ring_volumeZero_playsNothing", () => {
    expect(ring("cycle", ON, { volume: 0 }).played).toEqual([]);
  });

  test("ring_breakEnds_playsOnlyWithTheSwitchOn", () => {
    expect(ring("break", ON, { ringWhenBreakEnds: true }).played).toEqual([
      ["bowl", 0.7, 3],
    ]);
    expect(ring("break", ON, { ringWhenBreakEnds: false }).played).toEqual([]);
  });

  test("notify_onlyForACycleWithTheTabHiddenAndPermissionGranted", () => {
    expect(ring("cycle", ON, {}, true).notified).toEqual([
      [MESSAGE.title, MESSAGE.body],
    ]);
    expect(ring("cycle", ON, {}, false).notified).toEqual([]);
    expect(ring("cycle", ON, {}, true, "denied").notified).toEqual([]);
    expect(
      ring("cycle", { ...ON, notificationsEnabled: false }, {}, true).notified,
    ).toEqual([]);
    expect(ring("break", ON, {}, true).notified).toEqual([]);
  });
});

/** A context that records what the sound builds. */
function recordingContext() {
  const oscillators: { type: string; hz: number; start: number }[] = [];
  const peaks: number[] = [];
  const param = (onValue?: (value: number) => void) => ({
    setValueAtTime: (value: number) => onValue?.(value),
    linearRampToValueAtTime: (value: number) => peaks.push(value),
    exponentialRampToValueAtTime: () => undefined,
  });
  const context = {
    currentTime: 2,
    destination: {},
    createOscillator: () => {
      const record = { type: "", hz: 0, start: -1 };
      oscillators.push(record);
      return {
        set type(value: string) {
          record.type = value;
        },
        frequency: param((value) => {
          record.hz = value;
        }),
        connect: () => undefined,
        start: (at: number) => {
          record.start = at;
        },
        stop: () => undefined,
      };
    },
    createGain: () => ({ gain: param(), connect: () => undefined }),
  } as unknown as SoundContext;
  return { context, oscillators, peaks };
}

describe("Sounds", () => {
  test.each([
    ["bowl", "sine", 220, 4],
    ["wood", "triangle", 760, 3],
    ["chime", "sine", 880, 4],
  ] as const)(
    "playSound_%s_buildsItsPartials",
    (sound, wave, baseHz, count) => {
      const { context, oscillators } = recordingContext();

      const seconds = playSound(context, sound, 1);

      expect(oscillators).toHaveLength(count);
      expect(oscillators[0]).toEqual({ type: wave, hz: baseHz, start: 2 });
      expect(seconds).toBeGreaterThan(0);
    },
  );

  test("playSound_halfVolume_halvesEveryPeak", () => {
    const full = recordingContext();
    const half = recordingContext();

    playSound(full.context, "chime", 1);
    playSound(half.context, "chime", 0.5);

    expect(half.peaks).toEqual(full.peaks.map((peak) => peak / 2));
    expect(full.peaks.reduce((sum, peak) => sum + peak, 0)).toBeCloseTo(0.5);
  });

  test("playSound_volumeZero_buildsNothing", () => {
    const { context, oscillators } = recordingContext();

    expect(playSound(context, "bowl", 0)).toBe(0);
    expect(oscillators).toEqual([]);
  });
});

function renderApp(client: LedgerClient, bell = fakeBell()) {
  render(
    <StrictMode>
      <App
        client={client}
        timeZone="UTC"
        retryDelaysMs={[0]}
        bell={bell.deps}
      />
    </StrictMode>,
  );
  return bell;
}

async function advance(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

describe("Bell in the app", () => {
  test("cycleRunsOut_ringsTheSetNumberOfTimes", async () => {
    const bell = renderApp(
      recordingClient(exampleNodesWithNothingRunning()).client,
    );
    await startCycleOn("Book", "Shallow");

    await advance(25 * MINUTE_MS + 1000);
    await screen.findByText("25 min logged");

    expect(bell.played).toEqual([["bowl", 0.7, 3]]);
  });

  test("stopByHand_ringsNothing", async () => {
    const bell = renderApp(
      recordingClient(exampleNodesWithNothingRunning()).client,
    );
    await startCycleOn("Book");

    fireEvent.click(screen.getByRole("button", { name: /Stop and log/ }));
    await screen.findByRole("button", { name: "Start" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(bell.played).toEqual([]);
  });

  test("cycleRunsOutInAHiddenTab_showsTheNotification", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await recording.client.updateSettings({
      settings: { notificationsEnabled: true },
      updateMask: { paths: ["notifications_enabled"] },
    });
    const bell = renderApp(recording.client);
    await startCycleOn("Book", "Shallow");
    bell.setHidden(true);

    await advance(25 * MINUTE_MS + 1000);
    await screen.findByText("25 min logged");

    expect(bell.notified).toEqual([["Ekagra: Shallow cycle done", "Book"]]);
  });

  test("extensionRunsOut_rings", async () => {
    const bell = renderApp(
      recordingClient(exampleNodesWithNothingRunning()).client,
    );
    await startCycleOn("Book", "Shallow");
    await advance(25 * MINUTE_MS + 1000);
    fireEvent.change(
      await screen.findByRole("spinbutton", {
        name: "Keep going for more minutes",
      }),
      { target: { value: "5" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Keep going" }));
    await screen.findByRole("timer", { name: "Time left" });

    await advance(5 * MINUTE_MS + 1000);
    await screen.findByText("30 min logged");

    expect(bell.played).toEqual([
      ["bowl", 0.7, 3],
      ["bowl", 0.7, 3],
    ]);
  });

  async function startBreak(bell: ReturnType<typeof fakeBell>) {
    renderApp(recordingClient(exampleNodesWithNothingRunning()).client, bell);
    await screen.findByRole("button", { name: "Start" });
    fireEvent.click(screen.getByRole("button", { name: "Take a break" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Start the break" }),
    );
    await screen.findByRole("timer", { name: "Break time left" });
  }

  test("breakRunsOut_ringsWithTheSwitchOn", async () => {
    const bell = fakeBell();
    await startBreak(bell);

    await advance(5 * MINUTE_MS + 1000);
    await screen.findByRole("button", { name: "Start" });

    expect(bell.played).toEqual([["bowl", 0.7, 3]]);
  });

  test("breakRunsOut_switchOff_ringsNothing", async () => {
    saveLocalSettings({ ...LOCAL_DEFAULTS, ringWhenBreakEnds: false });
    const bell = fakeBell();
    await startBreak(bell);

    await advance(5 * MINUTE_MS + 1000);
    await screen.findByRole("button", { name: "Start" });

    expect(bell.played).toEqual([]);
  });

  test("breakEndedByHand_ringsNothing", async () => {
    const bell = fakeBell();
    await startBreak(bell);

    fireEvent.click(screen.getByRole("button", { name: "Start a cycle" }));
    await screen.findByRole("button", { name: "Start" });

    expect(bell.played).toEqual([]);
  });
});

describe("Bell in Settings", () => {
  async function openSettings(bell = fakeBell()) {
    renderApp(recordingClient(exampleNodesWithNothingRunning()).client, bell);
    await openFromTasks("Settings");
    await screen.findByRole("heading", { name: "The bell" });
    return bell;
  }

  test("settings_soundPick_playsOnceAndSilentPlaysNothing", async () => {
    const bell = await openSettings();

    pickSound("The bell", "Wood");
    pickSound("The bell", "Silent");

    expect(bell.played).toEqual([["wood", 0.7, 1]]);
    expect(soundPicker("The bell").textContent).toBe("Silent");
  });

  test("settings_soundPick_theCurrentOptionPlaysAgain", async () => {
    const bell = await openSettings();

    pickSound("The bell", "Bowl");
    pickSound("The bell", "Bowl");

    expect(bell.played).toEqual([
      ["bowl", 0.7, 1],
      ["bowl", 0.7, 1],
    ]);
  });

  test("settings_soundList_hasTheThreeSoundsAndSilent_andNoPlayButton", async () => {
    await openSettings();

    fireEvent.click(soundPicker("The bell"));

    expect(
      within(screen.getByRole("listbox"))
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Bowl", "Wood", "Chime", "Silent"]);
    expect(
      screen
        .getByRole("option", { name: "Bowl" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.queryByRole("button", { name: /Play/ })).toBeNull();
  });

  test("settings_soundKeyboard_arrowsMoveEnterPicksAndEscapeCloses", async () => {
    const bell = await openSettings();
    const picker = soundPicker("The bell");

    fireEvent.keyDown(picker, { key: "ArrowDown" });
    const list = screen.getByRole("listbox");
    expect(document.activeElement).toBe(list);
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "Enter" });

    expect(bell.played).toEqual([["wood", 0.7, 1]]);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(picker);
    expect(loadLocalSettings().sound).toBe("wood");

    fireEvent.click(picker);
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(bell.played).toHaveLength(1);
  });

  test("settings_focusSound_usesTheSamePicker", async () => {
    await openSettings();

    fireEvent.click(soundPicker("Focus sound"));

    expect(
      within(screen.getByRole("listbox"))
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual([
      "None",
      "Ticking fast",
      "Ticking slow",
      "White noise",
      "Brown noise",
    ]);
  });

  test("settings_notificationsOn_asksThenTurnsOn", async () => {
    const bell = await openSettings(fakeBell("default", "granted"));
    const toggle = screen.getByRole("switch", {
      name: "Show a notification when it rings",
    });

    fireEvent.click(toggle);

    await vi.waitFor(() =>
      expect(toggle.getAttribute("aria-checked")).toBe("true"),
    );
    expect(bell.requests).toEqual(["granted"]);
  });

  test("settings_notificationsDenied_staysOffAndSaysWhy", async () => {
    await openSettings(fakeBell("default", "denied"));
    const toggle = screen.getByRole("switch", {
      name: "Show a notification when it rings",
    });

    fireEvent.click(toggle);

    expect(
      await screen.findByText(/The browser blocks notifications/),
    ).toBeDefined();
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  test("settings_notificationsUnsupported_staysOffAndSaysWhy", async () => {
    await openSettings(fakeBell("unsupported", "unsupported"));

    fireEvent.click(
      screen.getByRole("switch", { name: "Show a notification when it rings" }),
    );

    expect(
      await screen.findByText("This browser cannot show notifications."),
    ).toBeDefined();
  });
});
