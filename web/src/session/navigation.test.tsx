import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "../App";
import type { LedgerClient } from "../api/ledgerClient";
import { exampleNow } from "../ledger/exampleData";
import { LOCAL_DEFAULTS, saveLocalSettings } from "../settings/localSettings";
import {
  exampleNodesWithNothingRunning,
  recordingClient,
} from "../testing/appHarness";
import { fakeBell } from "../testing/fakeBell";
import { startCycleOn } from "../testing/navigation";

const MINUTE_MS = 60_000;

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(exampleNow);
});

afterEach(() => {
  vi.useRealTimers();
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

/** Runs a 25-minute Shallow cycle on Book. */
async function startShallow(bell = fakeBell()) {
  const recording = recordingClient(exampleNodesWithNothingRunning());
  renderApp(recording.client, bell);
  await startCycleOn("Book", "Shallow");
  return recording;
}

function header() {
  return within(screen.getByRole("navigation", { name: "Views" }));
}

async function goToTasks() {
  fireEvent.click(header().getByRole("button", { name: "Tasks" }));
  await screen.findByRole("list", { name: "Tasks" });
}

function timeLeft() {
  return screen.getByRole("timer", { name: "Time left" }).textContent;
}

describe("Leaving the running screen", () => {
  test("awayAndBack_theClockKeptRunning", async () => {
    await startShallow();
    await advance(5 * MINUTE_MS);

    await goToTasks();
    await advance(3 * MINUTE_MS);
    fireEvent.click(header().getByRole("button", { name: /Shallow/ }));

    expect(timeLeft()).toBe("17:00");
  });

  test("chip_showsTheModeAndTheTimeLeft", async () => {
    await startShallow();
    await advance(5 * MINUTE_MS);

    await goToTasks();
    await advance(3 * MINUTE_MS);

    const chip = header().getByRole("button", { name: /Shallow/ });
    expect(chip.textContent).toBe("Shallow17:00");
    expect(chip.getAttribute("data-mode")).toBe("shallow");
  });

  test("wordmark_returnsToTheRunningScreen", async () => {
    await startShallow();
    await goToTasks();

    fireEvent.click(
      screen.getByRole("button", { name: /Ekagra, back to the timer/ }),
    );

    expect(screen.getByRole("timer", { name: "Time left" })).toBeDefined();
  });

  test("timeOutOnAnotherPage_opensTheBell", async () => {
    const bell = fakeBell();
    const recording = await startShallow(bell);
    await goToTasks();

    await advance(25 * MINUTE_MS + 1000);

    expect(await screen.findByRole("dialog")).toBeDefined();
    expect(await screen.findByText("25 min logged")).toBeDefined();
    expect(recording.updateCycleMinutes).toEqual([25]);
    expect(bell.played).toHaveLength(1);
  });

  test("pause_survivesAPageChange", async () => {
    const recording = await startShallow();
    await advance(5 * MINUTE_MS);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));

    await goToTasks();
    expect(header().getByRole("button", { name: /Shallow/ }).textContent).toBe(
      "Shallow20:00",
    );
    await advance(30 * MINUTE_MS);
    fireEvent.click(header().getByRole("button", { name: /Shallow/ }));

    expect(screen.getByRole("button", { name: "Resume" })).toBeDefined();
    expect(timeLeft()).toBe("20:00");
    expect(recording.updateCycleMinutes).toEqual([]);
  });

  test("settingsAndReport_showTheChipToo", async () => {
    await startShallow();
    await advance(MINUTE_MS);

    fireEvent.click(header().getByRole("button", { name: "Settings" }));
    await screen.findByRole("heading", { name: "Cycles" });
    expect(header().getByRole("button", { name: /Shallow/ }).textContent).toBe(
      "Shallow24:00",
    );

    await goToTasks();
    fireEvent.click(header().getByRole("button", { name: "Report" }));
    expect(
      (await screen.findByRole("button", { name: /Shallow/ })).textContent,
    ).toBe("Shallow24:00");
  });

  test("focusSound_keepsPlayingOnAnotherPage", async () => {
    saveLocalSettings({ ...LOCAL_DEFAULTS, focusSound: "brown-noise" });
    const bell = fakeBell();
    await startShallow(bell);
    await vi.waitFor(() => expect(bell.playingFocus()).toHaveLength(1));

    await goToTasks();

    expect(bell.playingFocus()).toHaveLength(1);
  });
});

describe("Leaving the bell and the break", () => {
  test("bell_headerLinks_work_andTheWordmarkReturnsToTheBell", async () => {
    await startShallow();
    await advance(25 * MINUTE_MS + 1000);
    await screen.findByRole("dialog");

    await goToTasks();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: /Ekagra, back to the timer/ }),
    );

    expect(screen.getByRole("dialog")).toBeDefined();
  });

  test("break_countsDownOnAnotherPage_andEndsOnStart", async () => {
    const bell = fakeBell();
    renderApp(recordingClient(exampleNodesWithNothingRunning()).client, bell);
    await screen.findByRole("button", { name: "Start" });
    fireEvent.click(screen.getByRole("button", { name: "Take a break" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Start the break" }),
    );
    await advance(MINUTE_MS);

    await goToTasks();
    expect(
      header().getByRole("button", { name: /Short break/ }).textContent,
    ).toBe("Short break04:00");
    await advance(4 * MINUTE_MS + 1000);

    expect(await screen.findByRole("button", { name: "Start" })).toBeDefined();
    expect(bell.played).toHaveLength(1);
  });
});
