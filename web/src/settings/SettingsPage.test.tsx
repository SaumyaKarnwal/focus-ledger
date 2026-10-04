import { Code } from "@connectrpc/connect";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "../App";
import type { LedgerClient } from "../api/ledgerClient";
import { exampleNow } from "../ledger/exampleData";
import {
  exampleNodesWithNothingRunning,
  recordingClient,
} from "../testing/appHarness";
import { fakeBell } from "../testing/fakeBell";
import { openFromTasks, startCycleOn } from "../testing/navigation";
import {
  LOCAL_DEFAULTS,
  loadLocalSettings,
  saveLocalSettings,
} from "./localSettings";
import { changedPaths, SAVE_DELAY_MS, toForm } from "./settingsModel";

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(exampleNow);
});

afterEach(() => {
  vi.useRealTimers();
});

function renderApp(client: LedgerClient) {
  return render(
    <StrictMode>
      <App
        client={client}
        timeZone="UTC"
        retryDelaysMs={[0]}
        bell={fakeBell().deps}
      />
    </StrictMode>,
  );
}

async function openSettings(client: LedgerClient) {
  renderApp(client);
  await openFromTasks("Settings");
  await screen.findByRole("heading", { name: "Cycles" });
}

function value(name: string) {
  return screen.getByRole("status", { name }).textContent;
}

function step(name: string, direction: "less" | "more", times = 1) {
  const button = screen.getByRole("button", { name: `${name}: ${direction}` });
  Array.from({ length: times }).forEach(() => fireEvent.click(button));
}

async function waitForSave() {
  await act(() => vi.advanceTimersByTimeAsync(SAVE_DELAY_MS + 50));
}

function checked(role: "radio" | "switch", name: string) {
  return screen.getByRole(role, { name }).getAttribute("aria-checked");
}

describe("Settings page", () => {
  test("settings_open_showsTheStoredValues", async () => {
    await openSettings(
      recordingClient(exampleNodesWithNothingRunning()).client,
    );

    expect(value("Deep Focus minutes")).toBe("90");
    expect(value("Execution minutes")).toBe("50");
    expect(value("Shallow minutes")).toBe("25");
    expect(value("Short break minutes")).toBe("5");
    expect(value("Long break minutes")).toBe("15");
    expect(value("Long break every")).toBe("4");
    expect(checked("radio", "Bowl")).toBe("true");
    expect(checked("switch", "Show a notification when it rings")).toBe(
      "false",
    );
    expect(checked("switch", "Ring when a break ends")).toBe("true");
  });

  test("settings_fromTheStartHeader_opensThePage", async () => {
    renderApp(recordingClient(exampleNodesWithNothingRunning()).client);
    const nav = await screen.findByRole("navigation", { name: "Views" });

    fireEvent.click(within(nav).getByRole("button", { name: "Settings" }));

    expect(
      await screen.findByRole("heading", { name: "Cycles" }),
    ).toBeDefined();
    expect(
      within(screen.getByRole("navigation", { name: "Views" }))
        .getByRole("button", { name: "Settings" })
        .getAttribute("aria-current"),
    ).toBe("page");
  });

  test("settings_changeTwoFields_sendsOnlyThosePathsAndStartUsesThem", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    const update = vi.spyOn(recording.client, "updateSettings");
    await openSettings(recording.client);

    step("Deep Focus minutes", "more");
    fireEvent.click(
      screen.getByRole("switch", { name: "Show a notification when it rings" }),
    );
    expect(update).not.toHaveBeenCalled();
    await waitForSave();

    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].updateMask?.paths).toEqual([
      "deep_focus_minutes",
      "notifications_enabled",
    ]);
    const { settings } = await recording.client.getSettings({});
    expect(settings).toMatchObject({
      deepFocusMinutes: 95,
      notificationsEnabled: true,
    });
    fireEvent.click(screen.getByRole("button", { name: /back to Start/ }));
    expect(
      (await screen.findByRole("status", { name: "Length" })).textContent,
    ).toBe("95:00");
  });

  test("settings_quickSteps_sendOneWriteWithTheLastValue", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    const update = vi.spyOn(recording.client, "updateSettings");
    await openSettings(recording.client);

    step("Shallow minutes", "more", 3);
    await waitForSave();

    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].settings?.shallowMinutes).toBe(40);
  });

  test("settings_changeThenBack_writesNothing", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    const update = vi.spyOn(recording.client, "updateSettings");
    await openSettings(recording.client);

    step("Execution minutes", "more");
    step("Execution minutes", "less");
    await waitForSave();

    expect(update).not.toHaveBeenCalled();
  });

  test("settings_leaveBeforeTheDelay_stillSendsTheChange", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await openSettings(recording.client);

    step("Short break minutes", "more");
    fireEvent.click(screen.getByRole("button", { name: /back to Start/ }));
    await screen.findByRole("button", { name: "Start" });

    await vi.waitFor(async () => {
      const { settings } = await recording.client.getSettings({});
      expect(settings?.breakMinutes).toBe(6);
    });
  });

  test("settings_shortBreak_staysWithinOneToSixty", async () => {
    await openSettings(
      recordingClient(exampleNodesWithNothingRunning()).client,
    );

    step("Short break minutes", "less", 10);
    expect(value("Short break minutes")).toBe("1");
    step("Short break minutes", "more", 70);
    expect(value("Short break minutes")).toBe("60");
  });

  test("settings_localFields_goToBrowserStorageOnly", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    const update = vi.spyOn(recording.client, "updateSettings");
    await openSettings(recording.client);

    step("Long break minutes", "more");
    step("Long break every", "less");
    fireEvent.click(screen.getByRole("radio", { name: "Wood" }));
    fireEvent.change(screen.getByRole("slider", { name: "Volume" }), {
      target: { value: "40" },
    });
    fireEvent.click(
      screen.getByRole("switch", { name: "Ring when a break ends" }),
    );
    await waitForSave();

    expect(update).not.toHaveBeenCalled();
    expect(loadLocalSettings()).toEqual({
      longBreakMinutes: 20,
      longBreakEvery: 3,
      sound: "wood",
      volume: 0.4,
      ringWhenBreakEnds: false,
      ringTimes: 3,
      focusSound: "none",
      focusVolume: 0.4,
    });
    expect(checked("radio", "Wood")).toBe("true");
  });

  test("settings_silentThenChime_togglesSoundEnabledAndKeepsTheChoiceLocal", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    const update = vi.spyOn(recording.client, "updateSettings");
    await openSettings(recording.client);

    fireEvent.click(screen.getByRole("radio", { name: "Silent" }));
    await waitForSave();
    expect(update.mock.calls.map((call) => call[0].updateMask?.paths)).toEqual([
      ["sound_enabled"],
    ]);
    expect(checked("radio", "Bowl")).toBe("false");

    fireEvent.click(screen.getByRole("radio", { name: "Chime" }));
    await waitForSave();

    expect(update.mock.calls.map((call) => call[0].updateMask?.paths)).toEqual([
      ["sound_enabled"],
      ["sound_enabled"],
    ]);
    const { settings } = await recording.client.getSettings({});
    expect(settings?.soundEnabled).toBe(true);
    expect(loadLocalSettings().sound).toBe("chime");
  });

  test("settings_saveFails_showsTheErrorAndKeepsTheValue", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    recording.failNext("UpdateSettings", Code.Internal);
    await openSettings(recording.client);

    step("Deep Focus minutes", "more");
    await waitForSave();

    expect((await screen.findByRole("alert")).textContent).toContain(
      "not saved",
    );
    expect(value("Deep Focus minutes")).toBe("95");
  });

  test("settings_longBreak_isTheBreakScreenLength", async () => {
    saveLocalSettings({ ...LOCAL_DEFAULTS, longBreakMinutes: 25 });
    renderApp(recordingClient(exampleNodesWithNothingRunning()).client);
    await startCycleOn("Book");
    fireEvent.click(screen.getByRole("button", { name: /Stop and log/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Take a break" }),
    );

    fireEvent.click(await screen.findByRole("radio", { name: "Long break" }));

    expect(
      screen.getByLabelText("Break length", { selector: "output" }).textContent,
    ).toBe("25:00");
  });
});

describe("Settings storage", () => {
  test("changedPaths_twoFields_areInAFixedOrder", () => {
    const before = toForm({
      deepFocusMinutes: 90,
      executionMinutes: 50,
      shallowMinutes: 25,
      breakMinutes: 5,
      soundEnabled: true,
      notificationsEnabled: false,
    } as Parameters<typeof toForm>[0]);

    expect(
      changedPaths(before, {
        ...before,
        notificationsEnabled: true,
        deepFocusMinutes: 95,
      }),
    ).toEqual(["deep_focus_minutes", "notifications_enabled"]);
  });

  test("loadLocalSettings_badOrMissingValues_fallBackToTheDefaults", () => {
    expect(loadLocalSettings()).toEqual(LOCAL_DEFAULTS);
    localStorage.setItem(
      "focus-ledger.settings",
      JSON.stringify({
        longBreakMinutes: 3,
        longBreakEvery: 99,
        sound: "gong",
        volume: 0.3,
      }),
    );

    expect(loadLocalSettings()).toEqual({ ...LOCAL_DEFAULTS, volume: 0.3 });
  });

  test("loadLocalSettings_brokenJson_isTheDefaults", () => {
    localStorage.setItem("focus-ledger.settings", "{not json");

    expect(loadLocalSettings()).toEqual(LOCAL_DEFAULTS);
  });
});
