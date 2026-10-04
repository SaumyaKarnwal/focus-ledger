import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { Code } from "@connectrpc/connect";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "./App";
import type { LedgerClient } from "./api/ledgerClient";
import { FocusMode, type CyclePb } from "./gen/focusledger/v1/model_pb";
import { exampleNodes, exampleNow } from "./ledger/exampleData";
import { PRODUCT_NAME } from "./productName";
import {
  exampleNodesWithNothingRunning,
  recordingClient,
} from "./testing/appHarness";
import {
  openFromTasks,
  openOnStart,
  openTasks,
  pressStart,
  startCycleOn,
} from "./testing/navigation";

const MINUTE_MS = 60_000;

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
      <App client={client} timeZone="UTC" retryDelaysMs={[0]} />
    </StrictMode>,
  );
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function allCycles(client: LedgerClient): Promise<CyclePb[]> {
  const { nodes } = await client.listNodes({ includeClosed: true });
  return nodes.flatMap((node) => node.cycles);
}

/** A manual Stop writes the cycle and lands on Start, with no bell (README rule 11). */
async function backOnStart() {
  const start = await screen.findByRole("button", { name: "Start" });
  expect(screen.queryByRole("dialog")).toBeNull();
  return start;
}

describe("App", () => {
  test("App_render_showsProductName", async () => {
    renderApp(recordingClient(exampleNodesWithNothingRunning()).client);

    expect(screen.getByRole("heading", { name: PRODUCT_NAME })).toBeDefined();
    await screen.findByRole("button", { name: "Start" });
  });
});

describe("Start", () => {
  test("start_selectedNodeAndMode_writesRunningCycleAndShowsTimer", async () => {
    const { client } = recordingClient(exampleNodesWithNothingRunning());
    renderApp(client);
    await screen.findByRole("button", { name: "Start" });
    await startCycleOn("Book", "Execution");

    expect(screen.getByRole("timer", { name: "Time left" }).textContent).toBe(
      "50:00",
    );
    expect(
      screen.getByText("Book", { selector: ".task-strip-name" }),
    ).toBeDefined();
    const running = (await allCycles(client)).filter(
      (cycle) => cycle.minutes === undefined,
    );
    expect(running).toMatchObject([
      {
        nodeId: "00000000-0000-4000-8000-00000000000a",
        mode: FocusMode.EXECUTION,
        plannedMinutes: 50,
      },
    ]);
  });

  test("start_responseLostThenRetried_createsOneCycle", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    const cyclesBefore = (await allCycles(recording.client)).length;
    renderApp(recording.client);
    await screen.findByRole("button", { name: "Start" });

    await openOnStart("Book");

    recording.loseNextResponse();

    await pressStart();

    expect(recording.createCycleRequestIds).toHaveLength(2);
    expect(new Set(recording.createCycleRequestIds).size).toBe(1);
    expect(await allCycles(recording.client)).toHaveLength(cyclesBefore + 1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("start_twoPresses_sendTwoRequestIds", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    renderApp(recording.client);

    await startCycleOn("Book");
    fireEvent.click(screen.getByRole("button", { name: /Stop and log/ }));
    await backOnStart();
    await startCycleOn("Book");

    expect(new Set(recording.createCycleRequestIds).size).toBe(2);
  });
});

describe("Stop", () => {
  test("stop_afterTwelveAndAHalfMinutes_logsTwelveAndGoesHome", async () => {
    const { client } = recordingClient(exampleNodesWithNothingRunning());
    renderApp(client);
    await startCycleOn("Book", "Deep Focus");

    await advance(12.5 * MINUTE_MS);
    fireEvent.click(
      screen.getByRole("button", { name: "Stop and log 12 min" }),
    );

    expect(await backOnStart()).toBeDefined();
    expect(
      screen
        .getByRole("radio", { name: "Deep Focus" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen.getByText("Book", { selector: ".task-strip-name" }),
    ).toBeDefined();
    const stopped = (await allCycles(client)).filter(
      (cycle) => cycle.minutes === 12,
    );
    expect(stopped).toMatchObject([
      { nodeId: "00000000-0000-4000-8000-00000000000a", plannedMinutes: 90 },
    ]);
  });

  test("stop_byHand_startSelectsTheCycleModeAndTask", async () => {
    renderApp(recordingClient(exampleNodesWithNothingRunning()).client);
    await screen.findByRole("button", { name: "Start" });
    await startCycleOn("Book", "Shallow");
    await advance(3 * MINUTE_MS);

    fireEvent.click(screen.getByRole("button", { name: "Stop and log 3 min" }));

    await backOnStart();
    expect(
      screen
        .getByRole("radio", { name: "Shallow" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen.getByText("Book", { selector: ".task-strip-name" }),
    ).toBeDefined();
  });

  test("stop_byHandOnAnInboxCycle_startShowsTheEmptyStrip", async () => {
    renderApp(recordingClient(exampleNodesWithNothingRunning()).client);
    await screen.findByRole("button", { name: "Start" });
    fireEvent.click(screen.getByRole("button", { name: /Working on/ }));
    fireEvent.click(screen.getByText("Not sure yet"));
    await pressStart();

    fireEvent.click(screen.getByRole("button", { name: /Stop and log/ }));

    await backOnStart();
    expect(screen.getByText("What are you working on?")).toBeDefined();
  });

  test("stop_underOneMinute_logsOneMinute", async () => {
    renderApp(recordingClient(exampleNodesWithNothingRunning()).client);
    await startCycleOn("Book");

    await advance(20_000);
    fireEvent.click(screen.getByRole("button", { name: "Stop and log 1 min" }));

    expect(await backOnStart()).toBeDefined();
  });

  test("running_countdownReachesZero_logsPlannedMinutesAndRings", async () => {
    const { client } = recordingClient(exampleNodesWithNothingRunning());
    renderApp(client);
    await screen.findByRole("button", { name: "Start" });
    await startCycleOn("Book", "Shallow");

    await advance(25 * MINUTE_MS + 1000);

    expect(await screen.findByText("25 min logged")).toBeDefined();
    expect(
      (await allCycles(client)).some((cycle) => cycle.minutes === undefined),
    ).toBe(false);
  });

  test("running_timerRegion_namesTheModeForScreenReaders", async () => {
    renderApp(recordingClient(exampleNodesWithNothingRunning()).client);
    await startCycleOn("Book", "Shallow");

    const cycle = screen.getByRole("region", { name: "Cycle" });
    expect(within(cycle).getByText("Shallow cycle").className).toContain(
      "visually-hidden",
    );
  });

  test("running_screen_hasNoLengthOrModeControl", async () => {
    renderApp(recordingClient(exampleNodesWithNothingRunning()).client);
    await startCycleOn("Book");

    const cycle = screen.getByRole("region", { name: "Cycle" });
    expect(
      within(cycle)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["PAUSE", "Stop and log"]);
    expect(
      screen.getByRole("button", { name: "Stop and log 1 min" }),
    ).toBeDefined();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });
});

describe("Pause", () => {
  async function startShallow(client: LedgerClient) {
    renderApp(client);
    await screen.findByRole("button", { name: "Start" });
    await startCycleOn("Book", "Shallow");
  }

  function timeLeft() {
    return screen.getByRole("timer", { name: "Time left" }).textContent;
  }

  test("pause_stopsTheCountdownAndResumeContinuesIt", async () => {
    await startShallow(
      recordingClient(exampleNodesWithNothingRunning()).client,
    );
    await advance(5 * MINUTE_MS);
    expect(timeLeft()).toBe("20:00");

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await advance(3 * MINUTE_MS);

    expect(timeLeft()).toBe("20:00");
    expect(screen.getByRole("status").textContent).toContain("Paused");
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await advance(MINUTE_MS);
    expect(timeLeft()).toBe("19:00");
  });

  test("pause_stopAfterAPause_logsTheMinutesWithoutThePausedTime", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await startShallow(recording.client);
    await advance(6.5 * MINUTE_MS);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await advance(4 * MINUTE_MS);
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await advance(3 * MINUTE_MS);

    fireEvent.click(screen.getByRole("button", { name: "Stop and log 9 min" }));

    expect(await backOnStart()).toBeDefined();
    expect(recording.updateCycleMinutes).toEqual([9]);
  });

  test("pause_twoHours_doesNotStopTheCycle_andResumeLogsOnlyTheWork", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await startShallow(recording.client);
    await advance(7 * MINUTE_MS + 20_000);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));

    await advance(2 * 60 * MINUTE_MS);

    expect(timeLeft()).toBe("17:40");
    expect(screen.getByRole("status").textContent).toBe("Paused");
    expect(recording.updateCycleMinutes).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await advance(3 * MINUTE_MS);
    fireEvent.click(
      screen.getByRole("button", { name: "Stop and log 10 min" }),
    );

    expect(await backOnStart()).toBeDefined();
    expect(recording.updateCycleMinutes).toEqual([10]);
  });

  test("pause_twoHours_stopWhilePaused_logsOnlyTheWork", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await startShallow(recording.client);
    await advance(7 * MINUTE_MS + 20_000);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await advance(2 * 60 * MINUTE_MS);

    fireEvent.click(screen.getByRole("button", { name: "Stop and log 7 min" }));

    expect(await backOnStart()).toBeDefined();
    expect(recording.updateCycleMinutes).toEqual([7]);
  });

  test("pause_pausedPastThePlannedEnd_doesNotRing", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await startShallow(recording.client);
    await advance(20 * MINUTE_MS);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await advance(6 * MINUTE_MS);

    expect(timeLeft()).toBe("05:00");
    expect(recording.updateCycleMinutes).toEqual([]);
  });

  test("pause_reload_keepsThePausedTimeOutOfTheWork", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await startShallow(recording.client);
    await advance(5 * MINUTE_MS);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await advance(2 * MINUTE_MS);
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await advance(MINUTE_MS);
    cleanup();

    renderApp(recording.client);

    expect(
      (await screen.findByRole("timer", { name: "Time left" })).textContent,
    ).toBe("19:00");
  });

  test("pause_reloadDuringAPause_staysPausedWithNoLimit", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await startShallow(recording.client);
    await advance(5 * MINUTE_MS);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await advance(4 * MINUTE_MS);
    cleanup();

    renderApp(recording.client);

    expect(
      (await screen.findByRole("timer", { name: "Time left" })).textContent,
    ).toBe("20:00");
    expect(screen.getByRole("button", { name: "Resume" })).toBeDefined();
    await advance(60 * MINUTE_MS);
    expect(timeLeft()).toBe("20:00");
    expect(recording.updateCycleMinutes).toEqual([]);
  });

  test("pause_stop_removesTheStoredPause", async () => {
    await startShallow(
      recordingClient(exampleNodesWithNothingRunning()).client,
    );
    await advance(2 * MINUTE_MS);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(Object.keys(localStorage).some((key) => key.includes("pause"))).toBe(
      true,
    );

    fireEvent.click(screen.getByRole("button", { name: "Stop and log 2 min" }));

    await backOnStart();
    expect(Object.keys(localStorage).some((key) => key.includes("pause"))).toBe(
      false,
    );
  });

  test("pause_storageBlocked_stillPausesInMemory", async () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    await startShallow(
      recordingClient(exampleNodesWithNothingRunning()).client,
    );
    await advance(5 * MINUTE_MS);

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await advance(2 * MINUTE_MS);

    expect(timeLeft()).toBe("20:00");
    setItem.mockRestore();
  });
});

describe("Bell and extension", () => {
  async function ringAfterFullCycle(client: LedgerClient) {
    const rendered = renderApp(client);
    await screen.findByRole("button", { name: "Start" });
    await startCycleOn("Book", "Execution");
    await advance(50 * MINUTE_MS + 1000);
    await screen.findByText("50 min logged");
    return rendered;
  }

  test("bell_onOpen_extensionFieldIsEmpty", async () => {
    await ringAfterFullCycle(
      recordingClient(exampleNodesWithNothingRunning()).client,
    );

    const field = screen.getByRole("spinbutton", {
      name: "Keep going for more minutes",
    }) as HTMLInputElement;
    expect(field.value).toBe("");
    expect(
      (screen.getByRole("button", { name: "Keep going" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  function keepGoingFor(minutes: number) {
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Keep going for more minutes" }),
      { target: { value: String(minutes) } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Keep going" }));
    return screen.findByRole("timer", { name: "Time left" });
  }

  async function loggedMinutesOfNewCycle(client: LedgerClient) {
    const seeded = new Set(
      exampleNodesWithNothingRunning()
        .flatMap((node) => node.cycles)
        .map((cycle) => cycle.id),
    );
    return (await allCycles(client))
      .filter((cycle) => !seeded.has(cycle.id))
      .map((cycle) => cycle.minutes);
  }

  test("bell_extendFifteenOnFifty_logsOneCycleOfSixtyFiveAtTheEnd", async () => {
    const { client } = recordingClient(exampleNodesWithNothingRunning());
    await ringAfterFullCycle(client);

    const timer = await keepGoingFor(15);

    expect(timer.textContent).toBe("15:00");
    expect(await loggedMinutesOfNewCycle(client)).toEqual([50]);
    await advance(15 * MINUTE_MS + 1000);
    expect(await screen.findByText("65 min logged")).toBeDefined();
    expect(await loggedMinutesOfNewCycle(client)).toEqual([65]);
  });

  test("extension_stopAfterSixAndAHalfMinutes_logsOnlyTheWorkedMinutes", async () => {
    const { client } = recordingClient(exampleNodesWithNothingRunning());
    await ringAfterFullCycle(client);
    await keepGoingFor(15);

    await advance(6.5 * MINUTE_MS);
    fireEvent.click(
      screen.getByRole("button", { name: "Stop and log 56 min" }),
    );

    expect(await backOnStart()).toBeDefined();
    expect(await loggedMinutesOfNewCycle(client)).toEqual([56]);
  });

  test("extension_stopUnderOneMinute_keepsTheLoggedMinutes", async () => {
    const { client } = recordingClient(exampleNodesWithNothingRunning());
    await ringAfterFullCycle(client);
    await keepGoingFor(15);

    await advance(30_000);
    fireEvent.click(
      screen.getByRole("button", { name: "Stop and log 50 min" }),
    );

    expect(await backOnStart()).toBeDefined();
    expect(await loggedMinutesOfNewCycle(client)).toEqual([50]);
  });

  test("extension_reloadMidway_resumesTheCountdown", async () => {
    const { client } = recordingClient(exampleNodesWithNothingRunning());
    const first = await ringAfterFullCycle(client);
    await keepGoingFor(15);
    await advance(5 * MINUTE_MS);
    first.unmount();

    renderApp(client);

    const timer = await screen.findByRole("timer", { name: "Time left" });
    expect(timer.textContent).toBe("10:00");
    expect(
      screen.getByRole("button", { name: "Stop and log 55 min" }),
    ).toBeDefined();
    expect(await loggedMinutesOfNewCycle(client)).toEqual([50]);
  });

  test("extension_reloadAfterItsEnd_logsTheFullExtension", async () => {
    const { client } = recordingClient(exampleNodesWithNothingRunning());
    const first = await ringAfterFullCycle(client);
    await keepGoingFor(15);
    first.unmount();
    await advance(20 * MINUTE_MS);

    renderApp(client);

    expect(await screen.findByText("65 min logged")).toBeDefined();
    expect(await loggedMinutesOfNewCycle(client)).toEqual([65]);
  });

  test("bell_startNewCycle_landsOnTodayWithModeSelection", async () => {
    await ringAfterFullCycle(
      recordingClient(exampleNodesWithNothingRunning()).client,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start a new cycle" }));

    expect(await screen.findByRole("button", { name: "Start" })).toBeDefined();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.queryByRole("timer")).toBeNull();
  });

  test("bell_overStart_showsTheCycleTaskAndModeAndKeepsThemAfter", async () => {
    renderApp(recordingClient(exampleNodesWithNothingRunning()).client);
    await startCycleOn("Book", "Execution");
    await advance(50 * MINUTE_MS + 1000);

    expect(
      await screen.findByRole("dialog", { name: "Execution · Book" }),
    ).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Start a new cycle" }));

    await screen.findByRole("button", { name: "Start" });
    expect(
      screen
        .getByRole("radio", { name: "Execution" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen.getByText("Book", { selector: ".task-strip-name" }),
    ).toBeDefined();
  });

  test("bell_inboxCycle_headingIsTheModeOnly", async () => {
    renderApp(recordingClient(exampleNodesWithNothingRunning()).client);
    await screen.findByRole("button", { name: "Start" });
    fireEvent.click(screen.getByRole("button", { name: /Working on/ }));
    fireEvent.click(screen.getByText("Not sure yet"));
    fireEvent.click(screen.getByRole("radio", { name: "Deep Focus" }));
    await pressStart();
    expect(
      screen.getByText("Not sure yet", { selector: ".task-strip-name" }),
    ).toBeDefined();
    await advance(90 * MINUTE_MS + 1000);

    expect(
      await screen.findByRole("dialog", { name: "Deep Focus" }),
    ).toBeDefined();
  });
});

describe("Break", () => {
  async function takeBreak() {
    renderApp(recordingClient(exampleNodesWithNothingRunning()).client);
    await startCycleOn("Book");
    fireEvent.click(screen.getByRole("button", { name: /Stop and log/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Take a break" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Start the break" }),
    );
    return screen.findByRole("timer", { name: "Break time left" });
  }

  test("break_fromBell_countsDownTheSettingsLength", async () => {
    const timer = await takeBreak();

    expect(timer.textContent).toBe("05:00");
    expect(screen.getByText(/^0 of 5 min/)).toBeDefined();
  });

  test("break_plusFive_addsFiveMinutes", async () => {
    const timer = await takeBreak();

    fireEvent.click(screen.getByRole("button", { name: "+5 min" }));

    expect(timer.textContent).toBe("10:00");
    expect(screen.getByText(/^0 of 10 min/)).toBeDefined();
  });

  test("break_startACycle_landsOnTodayWithNothingRunning", async () => {
    await takeBreak();

    fireEvent.click(screen.getByRole("button", { name: "Start a cycle" }));

    expect(await screen.findByRole("button", { name: "Start" })).toBeDefined();
    expect(screen.queryByRole("timer")).toBeNull();
  });

  test("break_longBreak_setsFifteenMinutes", async () => {
    renderApp(recordingClient(exampleNodesWithNothingRunning()).client);
    await startCycleOn("Book");
    fireEvent.click(screen.getByRole("button", { name: /Stop and log/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Take a break" }),
    );

    fireEvent.click(await screen.findByRole("radio", { name: "Long break" }));
    expect(
      screen.getByLabelText("Break length", { selector: "output" }).textContent,
    ).toBe("15:00");
    fireEvent.click(screen.getByRole("button", { name: "Shorter break" }));
    expect(
      screen.getByLabelText("Break length", { selector: "output" }).textContent,
    ).toBe("10:00");
  });

  test("break_comingBackTo_namesTheModeAndTaskAndReturnsToThem", async () => {
    renderApp(recordingClient(exampleNodesWithNothingRunning()).client);
    await startCycleOn("Book", "Shallow");
    fireEvent.click(screen.getByRole("button", { name: /Stop and log/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Take a break" }),
    );

    expect(await screen.findByText("Coming back to")).toBeDefined();
    expect(
      screen.getByText("Shallow", { selector: ".task-strip-name" }),
    ).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Start a cycle" }));

    await screen.findByRole("button", { name: "Start" });
    expect(
      screen
        .getByRole("radio", { name: "Shallow" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen.getByText("Book", { selector: ".task-strip-name" }),
    ).toBeDefined();
  });

  test("break_runsOut_landsOnToday", async () => {
    await takeBreak();

    await advance(5 * MINUTE_MS + 1000);

    expect(await screen.findByRole("button", { name: "Start" })).toBeDefined();
  });
});

describe("Reload", () => {
  test("reload_midCycle_showsTheSameCycleAndTime", async () => {
    const { client } = recordingClient(exampleNodes());
    const first = renderApp(client);

    const timer = await screen.findByRole("timer", { name: "Time left" });
    expect(timer.textContent).toBe("20:00");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "60",
    );
    expect(
      screen.getByText("Notes", { selector: ".task-strip-name" }),
    ).toBeDefined();
    first.unmount();

    await advance(2 * MINUTE_MS);
    renderApp(client);

    const timerAfterReload = await screen.findByRole("timer", {
      name: "Time left",
    });
    expect(timerAfterReload.textContent).toBe("18:00");
    expect(
      screen.getByText("Notes", { selector: ".task-strip-name" }),
    ).toBeDefined();
  });

  test("reload_afterTheEndTime_logsPlannedMinutesAndRings", async () => {
    const { client } = recordingClient(exampleNodes());
    vi.setSystemTime(new Date(exampleNow.getTime() + 30 * MINUTE_MS));

    renderApp(client);

    expect(await screen.findByText("50 min logged")).toBeDefined();
    const notesCycle = (await allCycles(client)).find(
      (cycle) => cycle.id === "00000000-0000-4000-8000-0000000000d2",
    );
    expect(notesCycle?.minutes).toBe(50);
  });
});

describe("Failures", () => {
  async function startShallowOnBook(client: LedgerClient) {
    renderApp(client);
    await screen.findByRole("button", { name: "Start" });
    await startCycleOn("Book", "Shallow");
  }

  test("running_automaticStopFails_userCanStopAgain", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await startShallowOnBook(recording.client);
    recording.failNext("UpdateCycle", Code.Internal);

    await advance(25 * MINUTE_MS + 1000);

    expect(await screen.findByRole("alert")).toBeDefined();
    fireEvent.click(
      screen.getByRole("button", { name: "Stop and log 25 min" }),
    );
    expect(await backOnStart()).toBeDefined();
  });

  test("extension_automaticStopFails_userCanStopAgain", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await startShallowOnBook(recording.client);
    await advance(25 * MINUTE_MS + 1000);
    await screen.findByText("25 min logged");
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Keep going for more minutes" }),
      { target: { value: "10" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Keep going" }));
    await screen.findByRole("timer", { name: "Time left" });
    recording.failNext("UpdateCycle", Code.Internal);

    await advance(10 * MINUTE_MS + 1000);

    expect(await screen.findByRole("alert")).toBeDefined();
    fireEvent.click(
      screen.getByRole("button", { name: "Stop and log 35 min" }),
    );
    expect(await backOnStart()).toBeDefined();
  });

  test("running_manualStopOpenWhenTimerEnds_writesOnce", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await startShallowOnBook(recording.client);
    await advance(24 * MINUTE_MS + 59_000);
    const release = recording.holdNext("UpdateCycle");

    fireEvent.click(
      screen.getByRole("button", { name: "Stop and log 24 min" }),
    );
    await advance(2000);
    release();

    expect(await backOnStart()).toBeDefined();
    expect(recording.updateCycleMinutes).toEqual([24]);
  });

  test("reload_runningCycleOnClosedNode_showsTheRunningCycle", async () => {
    const { client } = recordingClient(exampleNodes());
    await client.updateNode({
      nodeId: "00000000-0000-4000-8000-00000000000d",
      closed: true,
      updateMask: { paths: ["closed"] },
    });

    renderApp(client);

    const timer = await screen.findByRole("timer", { name: "Time left" });
    expect(timer.textContent).toBe("20:00");
    expect(
      screen.getByText("Notes", { selector: ".task-strip-name" }),
    ).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /Stop and log/ }));
    // The closed node is not the default task; the most recently worked open one is.
    expect(
      await screen.findByText("Book", { selector: ".task-strip-name" }),
    ).toBeDefined();
  });

  test("start_runningCycleUnderClosedParent_defaultTaskIsAnOpenOne", async () => {
    const { client } = recordingClient(exampleNodes());
    await client.updateNode({
      nodeId: "00000000-0000-4000-8000-00000000000b",
      closed: true,
      updateMask: { paths: ["closed"] },
    });
    renderApp(client);
    await screen.findByRole("timer", { name: "Time left" });

    fireEvent.click(screen.getByRole("button", { name: /Stop and log/ }));

    expect(
      await screen.findByText("Book", { selector: ".task-strip-name" }),
    ).toBeDefined();
  });

  test("stop_refreshFailsAfterTheWrite_stillGoesHome", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await startShallowOnBook(recording.client);
    recording.failNext("ListNodes", Code.Internal);

    fireEvent.click(screen.getByRole("button", { name: "Stop and log 1 min" }));

    expect(await backOnStart()).toBeDefined();
    expect(await screen.findByRole("alert")).toBeDefined();
  });

  test("stop_refreshNetworkFailure_isRetried", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await startShallowOnBook(recording.client);
    recording.failNext("ListNodes", Code.Unknown);

    fireEvent.click(screen.getByRole("button", { name: "Stop and log 1 min" }));

    expect(await backOnStart()).toBeDefined();
    await advance(100);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("start_networkFailure_isRetried", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    renderApp(recording.client);
    await screen.findByRole("button", { name: "Start" });
    await openOnStart("Book");
    recording.failNext("CreateCycle", Code.Unknown);
    await pressStart();

    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("firstLoadFails_tryAgain_loadsToday", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    // StrictMode runs the first-load effect twice, so both runs fail.
    recording.failNext("GetSettings", Code.Internal, 2);

    renderApp(recording.client);

    expect(await screen.findByRole("alert")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: "Start" })).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("Home", () => {
  function checkedMode() {
    return screen
      .getAllByRole("radio")
      .find((radio) => radio.getAttribute("aria-checked") === "true")
      ?.textContent;
  }

  function lengthText() {
    return screen.getByRole("status", { name: "Length" }).textContent;
  }

  test("start_newUser_opensStartEmptyOnDeepFocus", async () => {
    renderApp(recordingClient([]).client);
    await screen.findByRole("button", { name: "Start" });

    expect(screen.getByText("What are you working on?")).toBeDefined();
    expect(checkedMode()).toBe("Deep Focus");
    expect(lengthText()).toBe("90:00");
  });

  test("start_opensWithTheLastCycleTaskModeAndItsLengthFromSettings", async () => {
    const { client } = recordingClient(exampleNodesWithNothingRunning());
    await client.updateSettings({
      settings: { executionMinutes: 45 },
      updateMask: { paths: ["execution_minutes"] },
    });

    renderApp(client);
    await screen.findByRole("button", { name: "Start" });

    expect(checkedMode()).toBe("Execution");
    expect(lengthText()).toBe("45:00");
    expect(
      screen.getByText("Notes", { selector: ".task-strip-name" }),
    ).toBeDefined();
  });

  test("start_afterAReload_remembersTheCycleThatRanOut", async () => {
    const { client } = recordingClient(exampleNodesWithNothingRunning());
    const first = renderApp(client);
    await startCycleOn("Book", "Shallow");
    await advance(25 * MINUTE_MS + 1000);
    await screen.findByText("25 min logged");
    first.unmount();

    renderApp(client);
    await screen.findByRole("button", { name: "Start" });

    expect(checkedMode()).toBe("Shallow");
    expect(lengthText()).toBe("25:00");
    expect(
      screen.getByText("Book", { selector: ".task-strip-name" }),
    ).toBeDefined();
  });

  test("start_lastCycleOnTheInbox_opensWithTheEmptyStrip", async () => {
    const { client } = recordingClient(exampleNodesWithNothingRunning());
    const first = renderApp(client);
    await screen.findByRole("button", { name: "Start" });
    fireEvent.click(screen.getByRole("button", { name: /Working on/ }));
    fireEvent.click(screen.getByText("Not sure yet"));
    fireEvent.click(screen.getByRole("radio", { name: "Shallow" }));
    await pressStart();
    await advance(25 * MINUTE_MS + 1000);
    await screen.findByText("25 min logged");
    first.unmount();

    renderApp(client);
    await screen.findByRole("button", { name: "Start" });

    expect(screen.getByText("What are you working on?")).toBeDefined();
    expect(checkedMode()).toBe("Shallow");
  });

  test("wordmark_fromTasks_opensStartWithTheLastCycle", async () => {
    renderApp(recordingClient(exampleNodesWithNothingRunning()).client);
    await screen.findByRole("button", { name: "Start" });
    fireEvent.click(screen.getByRole("radio", { name: "Shallow" }));

    await openTasks();
    fireEvent.click(screen.getByRole("button", { name: /back to Start/ }));

    await screen.findByRole("button", { name: "Start" });
    expect(checkedMode()).toBe("Execution");
    expect(
      screen.getByText("Notes", { selector: ".task-strip-name" }),
    ).toBeDefined();
  });

  test("wordmark_fromReport_leadsHome", async () => {
    renderApp(recordingClient(exampleNodesWithNothingRunning()).client);
    await openFromTasks("Report");
    await screen.findByRole("heading", { name: "Node × mode" });

    fireEvent.click(
      screen.getByRole("button", { name: `${PRODUCT_NAME}, back to Start` }),
    );

    expect(await screen.findByRole("button", { name: "Start" })).toBeDefined();
  });

  test("wordmark_fromReportDuringACycle_returnsToTheTimer", async () => {
    renderApp(recordingClient(exampleNodesWithNothingRunning()).client);
    await startCycleOn("Book");
    await openFromTasks("Report");
    await screen.findByRole("heading", { name: "Node × mode" });

    fireEvent.click(
      screen.getByRole("button", {
        name: `${PRODUCT_NAME}, back to the timer`,
      }),
    );

    expect(
      await screen.findByRole("timer", { name: "Time left" }),
    ).toBeDefined();
  });
});
