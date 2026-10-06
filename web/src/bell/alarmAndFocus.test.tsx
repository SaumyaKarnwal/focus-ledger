import { act, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "../App";
import type { Ledger } from "../api/ledger";
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
import { pickSound } from "../testing/soundPicker";
import { ringBell } from "./bell";
import { focusSamples } from "./focusSound";
import { playRings, type SoundContext } from "./sounds";

const MINUTE_MS = 60_000;
const RATE = 8000;

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(exampleNow);
});

afterEach(() => {
  vi.useRealTimers();
});

function withLocal(local: Partial<LocalSettings>) {
  saveLocalSettings({ ...LOCAL_DEFAULTS, ...local });
}

function renderApp(client: Ledger, bell = fakeBell()) {
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

describe("Alarm repeat", () => {
  test("ring_usesTheRingTimesSetting", () => {
    const bell = fakeBell();

    ringBell(
      "cycle",
      { soundEnabled: true, notificationsEnabled: false },
      { ...LOCAL_DEFAULTS, ringTimes: 5 },
      { title: "", body: "" },
      bell.deps,
    );

    expect(bell.played).toEqual([["bowl", 0.7, 5]]);
  });

  test("playRings_schedulesEachRingAfterTheLast_andStopCutsTheRest", () => {
    const starts: number[] = [];
    let disconnected = 0;
    const param = {
      setValueAtTime: () => undefined,
      linearRampToValueAtTime: () => undefined,
      exponentialRampToValueAtTime: () => undefined,
    };
    const context = {
      currentTime: 10,
      destination: {},
      createOscillator: () => ({
        type: "",
        frequency: param,
        connect: () => undefined,
        start: (at: number) => starts.push(at),
        stop: () => undefined,
      }),
      createGain: () => ({
        gain: param,
        connect: () => undefined,
        disconnect: () => {
          disconnected += 1;
        },
      }),
    } as unknown as SoundContext;

    const rings = playRings(context, "chime", 0.7, 3);

    // Chime has four partials, and one ring follows another after 1.3 s.
    expect([...new Set(starts)]).toEqual([10, 11.3, 12.6]);
    expect(starts).toHaveLength(12);
    rings.stop();
    expect(disconnected).toBe(1);
  });

  test("bell_clickOnTheDialog_stopsTheRemainingRings", async () => {
    const bell = renderApp(
      recordingClient(exampleNodesWithNothingRunning()).client,
    );
    await startCycleOn("Book", "Shallow");
    await advance(25 * MINUTE_MS + 1000);
    const dialog = await screen.findByRole("dialog");
    expect(bell.played).toEqual([["bowl", 0.7, 3]]);
    expect(bell.ringStops).toEqual([]);

    fireEvent.pointerDown(dialog);

    expect(bell.ringStops).toEqual([1]);
  });

  test("bell_dismissWithTheKeyboard_stopsTheRemainingRings", async () => {
    const bell = renderApp(
      recordingClient(exampleNodesWithNothingRunning()).client,
    );
    await startCycleOn("Book", "Shallow");
    await advance(25 * MINUTE_MS + 1000);
    await screen.findByRole("dialog");

    fireEvent.keyDown(
      screen.getByRole("spinbutton", { name: "Keep going for more minutes" }),
      { key: "Tab" },
    );

    expect(bell.ringStops).toEqual([1]);
  });

  test("bell_silent_ringsNothing", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await recording.client.updateSettings({
      settings: { soundEnabled: false },
      updateMask: { paths: ["sound_enabled"] },
    });
    const bell = renderApp(recording.client);
    await startCycleOn("Book", "Shallow");

    await advance(25 * MINUTE_MS + 1000);
    await screen.findByRole("dialog");

    expect(bell.played).toEqual([]);
  });
});

describe("Focus sound", () => {
  test("focus_playsWhileTheCycleRuns_stopsOnPause_andResumes", async () => {
    withLocal({ focusSound: "tick-slow", focusVolume: 0.5 });
    const bell = renderApp(
      recordingClient(exampleNodesWithNothingRunning()).client,
    );
    expect(bell.playingFocus()).toEqual([]);

    await startCycleOn("Book");
    await vi.waitFor(() =>
      expect(bell.playingFocus()).toEqual([
        { sound: "tick-slow", volume: 0.5, stopped: false },
      ]),
    );

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(bell.playingFocus()).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(bell.playingFocus()).toHaveLength(1);
  });

  test("focus_stopsAtStop", async () => {
    withLocal({ focusSound: "white-noise" });
    const bell = renderApp(
      recordingClient(exampleNodesWithNothingRunning()).client,
    );
    await startCycleOn("Book");
    await vi.waitFor(() => expect(bell.playingFocus()).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: /Stop and log/ }));
    await screen.findByRole("button", { name: "Start" });

    // The Running screen's cleanup runs just after Start shows.
    await vi.waitFor(() => expect(bell.playingFocus()).toEqual([]));
  });

  test("focus_stopsAtTheBell", async () => {
    withLocal({ focusSound: "brown-noise" });
    const bell = renderApp(
      recordingClient(exampleNodesWithNothingRunning()).client,
    );
    await startCycleOn("Book", "Shallow");
    await vi.waitFor(() => expect(bell.playingFocus()).toHaveLength(1));

    await advance(25 * MINUTE_MS + 1000);
    await screen.findByRole("dialog");

    // The Running screen's cleanup runs just after the bell shows.
    await vi.waitFor(() => expect(bell.playingFocus()).toEqual([]));
  });

  test("focus_doesNotPlayOnABreak", async () => {
    withLocal({ focusSound: "tick-fast" });
    const bell = renderApp(
      recordingClient(exampleNodesWithNothingRunning()).client,
    );
    await screen.findByRole("button", { name: "Start" });
    fireEvent.click(screen.getByRole("button", { name: "Take a break" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Start the break" }),
    );
    await screen.findByRole("timer", { name: "Break time left" });

    expect(bell.focus).toEqual([]);
  });

  test("focus_playsDuringKeepGoing", async () => {
    withLocal({ focusSound: "tick-fast" });
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

    await vi.waitFor(() =>
      expect(bell.playingFocus()).toEqual([
        { sound: "tick-fast", volume: 0.4, stopped: false },
      ]),
    );
  });

  test("focus_none_neverPlays", async () => {
    const bell = renderApp(
      recordingClient(exampleNodesWithNothingRunning()).client,
    );
    await startCycleOn("Book");
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));

    expect(bell.focus).toEqual([]);
  });

  test("focusSamples_ticksAreShortClicksAtTheirRate", () => {
    const fast = focusSamples("tick-fast", RATE);
    const slow = focusSamples("tick-slow", RATE);

    expect(fast).toHaveLength(RATE / 2);
    expect(slow).toHaveLength(RATE);
    const lastSound = (samples: Float32Array) =>
      samples.reduce((last, value, index) => (value !== 0 ? index : last), -1);
    expect(lastSound(fast)).toBeLessThan(RATE * 0.012);
    expect(lastSound(slow)).toBeLessThan(RATE * 0.012);
  });

  test("focusSamples_noiseStaysWithinItsLevel", () => {
    const peak = (samples: Float32Array) =>
      samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0);

    expect(focusSamples("none", RATE)).toHaveLength(0);
    expect(peak(focusSamples("white-noise", RATE))).toBeLessThanOrEqual(0.18);
    expect(peak(focusSamples("brown-noise", RATE))).toBeCloseTo(0.5);
  });
});

describe("Settings: ring times and focus sound", () => {
  async function openSettings(bell = fakeBell()) {
    renderApp(recordingClient(exampleNodesWithNothingRunning()).client, bell);
    await openFromTasks("Settings");
    await screen.findByRole("heading", { name: "Focus sound" });
    return bell;
  }

  test("settings_ringTimes_defaultsToThreeAndStaysWithinOneToFive", async () => {
    await openSettings();
    const value = () => screen.getByRole("status", { name: "Ring times" });
    const more = screen.getByRole("button", { name: "Ring times: more" });
    const less = screen.getByRole("button", { name: "Ring times: less" });

    expect(value().textContent).toBe("3");
    Array.from({ length: 4 }).forEach(() => fireEvent.click(more));
    expect(value().textContent).toBe("5");
    Array.from({ length: 6 }).forEach(() => fireEvent.click(less));
    expect(value().textContent).toBe("1");
    expect(loadLocalSettings().ringTimes).toBe(1);
  });

  test("settings_focusPick_previewsForThreeSecondsAndStores", async () => {
    const bell = await openSettings();

    pickSound("Focus sound", "Brown noise");
    expect(bell.playingFocus()).toEqual([
      { sound: "brown-noise", volume: 0.4, stopped: false },
    ]);
    expect(loadLocalSettings().focusSound).toBe("brown-noise");

    await advance(3100);
    expect(bell.playingFocus()).toEqual([]);
  });

  test("settings_anotherFocusPick_stopsThePreviewBefore", async () => {
    const bell = await openSettings();

    pickSound("Focus sound", "White noise");
    pickSound("Focus sound", "Ticking fast");

    expect(bell.playingFocus().map((record) => record.sound)).toEqual([
      "tick-fast",
    ]);
    pickSound("Focus sound", "None");
    expect(bell.playingFocus()).toEqual([]);
    expect(loadLocalSettings().focusSound).toBe("none");
  });

  test("settings_focusVolume_isStored", async () => {
    await openSettings();

    fireEvent.change(
      screen.getByRole("slider", { name: "Focus sound Volume" }),
      { target: { value: "65" } },
    );

    expect(loadLocalSettings().focusVolume).toBe(0.65);
  });

  test("loadLocalSettings_badRingTimesOrFocusSound_fallBackToTheDefaults", () => {
    localStorage.setItem(
      "focus-ledger.settings",
      JSON.stringify({ ringTimes: 9, focusSound: "rain", focusVolume: 2 }),
    );

    expect(loadLocalSettings()).toMatchObject({
      ringTimes: 3,
      focusSound: "none",
      focusVolume: 0.4,
    });
  });
});
