import { act, fireEvent, render, screen, within } from "@testing-library/react";
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

async function startFromToday(nodeName: string) {
  const rail = await screen.findByRole("region", { name: "Open nodes" });
  fireEvent.click(within(rail).getByRole("button", { name: nodeName }));
  fireEvent.click(screen.getByRole("button", { name: "Start" }));
  await screen.findByRole("timer", { name: "Time left" });
}

describe("App", () => {
  test("App_render_showsProductName", async () => {
    renderApp(recordingClient(exampleNodesWithNothingRunning()).client);

    expect(screen.getByRole("heading", { name: PRODUCT_NAME })).toBeDefined();
    await screen.findByRole("button", { name: "Start" });
  });
});

describe("Today", () => {
  test("today_exampleData_listsOpenNodesByLastWork", async () => {
    renderApp(recordingClient(exampleNodesWithNothingRunning()).client);

    const rows = await screen.findAllByTestId("rail-row");

    expect(
      rows.map((row) => within(row).getByRole("button").textContent),
    ).toEqual(["Notes", "Book", "Chapter 1", "Admin"]);
    expect(
      rows.every((row) => /worked|created/.test(row.textContent ?? "")),
    ).toBe(true);
    expect(screen.getByText("2 unfiled")).toBeDefined();
  });

  test("today_exampleData_showsTodayAndWeekTotals", async () => {
    renderApp(recordingClient(exampleNodesWithNothingRunning()).client);

    const today = await screen.findByRole("group", { name: "Today" });
    const week = screen.getByRole("group", { name: "This week" });

    expect(within(today).getByRole("heading").textContent).toBe(
      "Today: 2h 30m",
    );
    expect(within(today).getByText("Deep Focus: 1h 15m")).toBeDefined();
    expect(within(week).getByRole("heading").textContent).toBe(
      "This week: 5h 50m",
    );
  });

  test("today_closeNode_leavesRailAndKeepsTotals", async () => {
    const { client } = recordingClient(exampleNodesWithNothingRunning());
    await client.updateNode({
      nodeId: "00000000-0000-4000-8000-00000000000b",
      closed: true,
      updateMask: { paths: ["closed"] },
    });

    renderApp(client);

    const rows = await screen.findAllByTestId("rail-row");
    expect(
      rows.map((row) => within(row).getByRole("button").textContent),
    ).toEqual(["Book", "Admin"]);
    expect(
      within(screen.getByRole("group", { name: "This week" })).getByRole(
        "heading",
      ).textContent,
    ).toBe("This week: 5h 50m");
  });

  test("today_selectRailRow_showsThatNodeWithItsProgress", async () => {
    renderApp(recordingClient(exampleNodesWithNothingRunning()).client);
    const rail = await screen.findByRole("region", { name: "Open nodes" });

    fireEvent.click(within(rail).getByRole("button", { name: "Book" }));

    const selected = screen.getByRole("region", { name: "Book" });
    expect(within(selected).getByText("3 of 5 cycles")).toBeDefined();
    expect(screen.getByTestId("meta-line").textContent).toContain(
      "cycle 4 of 5",
    );
    expect(
      within(selected).getByRole("list", { name: "Logged today" }).children,
    ).toHaveLength(1);
  });

  test("today_modeAndStepper_setLengthAndEndTime", async () => {
    renderApp(recordingClient(exampleNodesWithNothingRunning()).client);
    await screen.findByRole("button", { name: "Start" });

    expect(
      (screen.getByRole("radio", { name: "Deep Focus" }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    const endBefore = screen.getByTestId("meta-line").textContent;

    fireEvent.click(screen.getByRole("radio", { name: "Shallow" }));
    expect(screen.getByRole("status", { name: "Length" }).textContent).toBe(
      "25 min",
    );
    fireEvent.click(screen.getByRole("button", { name: "Longer" }));

    expect(screen.getByRole("status", { name: "Length" }).textContent).toBe(
      "30 min",
    );
    expect(screen.getByTestId("meta-line").textContent).not.toBe(endBefore);
  });
});

describe("Start", () => {
  test("start_selectedNodeAndMode_writesRunningCycleAndShowsTimer", async () => {
    const { client } = recordingClient(exampleNodesWithNothingRunning());
    renderApp(client);
    await screen.findByRole("button", { name: "Start" });
    fireEvent.click(screen.getByRole("radio", { name: "Execution" }));

    await startFromToday("Book");

    expect(screen.getByRole("timer", { name: "Time left" }).textContent).toBe(
      "50:00",
    );
    expect(screen.getByRole("heading", { name: "Book" })).toBeDefined();
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

  test("start_inboxSelected_writesCycleWithNoNode", async () => {
    const { client } = recordingClient(exampleNodesWithNothingRunning());
    renderApp(client);

    await startFromToday("Inbox");

    const running = (await allCycles(client)).find(
      (cycle) => cycle.minutes === undefined,
    );
    expect(running?.nodeId).toBeUndefined();
    expect(screen.getByRole("heading", { name: "Inbox" })).toBeDefined();
  });

  test("start_responseLostThenRetried_createsOneCycle", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    const cyclesBefore = (await allCycles(recording.client)).length;
    renderApp(recording.client);
    await screen.findByRole("button", { name: "Start" });

    recording.loseNextResponse();
    await startFromToday("Book");

    expect(recording.createCycleRequestIds).toHaveLength(2);
    expect(new Set(recording.createCycleRequestIds).size).toBe(1);
    expect(await allCycles(recording.client)).toHaveLength(cyclesBefore + 1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("start_twoPresses_sendTwoRequestIds", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    renderApp(recording.client);

    await startFromToday("Book");
    fireEvent.click(screen.getByRole("button", { name: /Stop and log/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Start a new cycle" }),
    );
    await startFromToday("Book");

    expect(new Set(recording.createCycleRequestIds).size).toBe(2);
  });
});

describe("Stop", () => {
  test("stop_afterTwelveAndAHalfMinutes_logsTwelveAndRings", async () => {
    const { client } = recordingClient(exampleNodesWithNothingRunning());
    renderApp(client);
    await startFromToday("Book");

    await advance(12.5 * MINUTE_MS);
    fireEvent.click(
      screen.getByRole("button", { name: "Stop and log 12 min" }),
    );

    expect(await screen.findByText("12 min logged")).toBeDefined();
    expect(screen.getByText("Deep Focus · logged")).toBeDefined();
    expect(screen.getByRole("heading", { name: "Book" })).toBeDefined();
    const stopped = (await allCycles(client)).filter(
      (cycle) => cycle.minutes === 12,
    );
    expect(stopped).toMatchObject([
      { nodeId: "00000000-0000-4000-8000-00000000000a", plannedMinutes: 90 },
    ]);
  });

  test("stop_underOneMinute_logsOneMinute", async () => {
    renderApp(recordingClient(exampleNodesWithNothingRunning()).client);
    await startFromToday("Book");

    await advance(20_000);
    fireEvent.click(screen.getByRole("button", { name: "Stop and log 1 min" }));

    expect(await screen.findByText("1 min logged")).toBeDefined();
  });

  test("running_countdownReachesZero_logsPlannedMinutesAndRings", async () => {
    const { client } = recordingClient(exampleNodesWithNothingRunning());
    renderApp(client);
    await screen.findByRole("button", { name: "Start" });
    fireEvent.click(screen.getByRole("radio", { name: "Shallow" }));
    await startFromToday("Book");

    await advance(25 * MINUTE_MS + 1000);

    expect(await screen.findByText("25 min logged")).toBeDefined();
    expect(
      (await allCycles(client)).some((cycle) => cycle.minutes === undefined),
    ).toBe(false);
  });

  test("running_screen_hasNoLengthOrModeControl", async () => {
    renderApp(recordingClient(exampleNodesWithNothingRunning()).client);
    await startFromToday("Book");

    expect(
      screen.getAllByRole("button").map((button) => button.textContent),
    ).toEqual(["Stop and log 1 min"]);
    expect(screen.queryByRole("radio")).toBeNull();
  });
});

describe("Bell and extension", () => {
  async function ringAfterFullCycle(client: LedgerClient) {
    const rendered = renderApp(client);
    await screen.findByRole("button", { name: "Start" });
    fireEvent.click(screen.getByRole("radio", { name: "Execution" }));
    await startFromToday("Book");
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

    expect(await screen.findByText("56 min logged")).toBeDefined();
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

    expect(await screen.findByText("50 min logged")).toBeDefined();
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
});

describe("Break", () => {
  async function takeBreak() {
    renderApp(recordingClient(exampleNodesWithNothingRunning()).client);
    await startFromToday("Book");
    fireEvent.click(screen.getByRole("button", { name: /Stop and log/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Take a break" }),
    );
    return screen.findByRole("timer", { name: "Break time left" });
  }

  test("break_fromBell_countsDownTheSettingsLength", async () => {
    const timer = await takeBreak();

    expect(timer.textContent).toBe("05:00");
    expect(screen.getByText("0 of 5 min")).toBeDefined();
  });

  test("break_plusFive_addsFiveMinutes", async () => {
    const timer = await takeBreak();

    fireEvent.click(screen.getByRole("button", { name: "+5 min" }));

    expect(timer.textContent).toBe("10:00");
    expect(screen.getByText("0 of 10 min")).toBeDefined();
  });

  test("break_skipAndStart_landsOnTodayWithNothingRunning", async () => {
    await takeBreak();

    fireEvent.click(screen.getByRole("button", { name: "Skip and start" }));

    expect(await screen.findByRole("button", { name: "Start" })).toBeDefined();
    expect(screen.queryByRole("timer")).toBeNull();
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
    expect(screen.getByText(/^30 of 50 min/)).toBeDefined();
    expect(screen.getByRole("heading", { name: "Notes" })).toBeDefined();
    first.unmount();

    await advance(2 * MINUTE_MS);
    renderApp(client);

    const timerAfterReload = await screen.findByRole("timer", {
      name: "Time left",
    });
    expect(timerAfterReload.textContent).toBe("18:00");
    expect(screen.getByRole("heading", { name: "Notes" })).toBeDefined();
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
