import { create } from "@bufbuild/protobuf";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "../App";
import type { LedgerClient } from "../api/ledgerClient";
import { FocusMode, SettingsPbSchema } from "../gen/focusledger/v1/model_pb";
import { exampleNodes, exampleNow } from "../ledger/exampleData";
import { weekRange } from "../ledger/period";
import {
  exampleNodesWithNothingRunning,
  recordingClient,
} from "../testing/appHarness";
import { openOnStart } from "../testing/navigation";
import { INBOX_ID, type TodayData } from "../today/todayModel";
import { StartScreen } from "./StartScreen";
import { taskStrip } from "./startModel";

const BOOK = "00000000-0000-4000-8000-00000000000a";
const NOTES = "00000000-0000-4000-8000-00000000000d";

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

function exampleData(): TodayData {
  return {
    email: "fake.user@example.com",
    settings: create(SettingsPbSchema, {
      deepFocusMinutes: 90,
      executionMinutes: 50,
      shallowMinutes: 25,
    }),
    allTimeNodes: exampleNodesWithNothingRunning().filter(
      (node) => !node.closed,
    ),
    weekNodes: exampleNodes(),
    week: weekRange(exampleNow, "UTC"),
  };
}

function screenRoot() {
  return document.querySelector(".mode-screen") as HTMLElement;
}

function length() {
  return screen.getByRole("status", { name: "Length" }).textContent;
}

describe("Start", () => {
  test("start_header_showsTheDateTasksSettingsAndInertReport", async () => {
    renderApp(recordingClient(exampleNodesWithNothingRunning()).client);
    const nav = await screen.findByRole("navigation", { name: "Views" });

    expect(screen.getByText("Sun 1 Nov")).toBeDefined();
    expect(within(nav).getByRole("button", { name: "Tasks" })).toBeDefined();
    expect(within(nav).queryByRole("button", { name: "Report" })).toBeNull();
    expect(within(nav).getByRole("button", { name: "Settings" })).toBeDefined();
    expect(within(nav).getByText("Report").getAttribute("aria-disabled")).toBe(
      "true",
    );
    expect(
      screen.getByRole("button", { name: "Your account" }).textContent,
    ).toBe("F");
  });

  test("start_tasksInTheHeader_opensTheTasksPage", async () => {
    renderApp(recordingClient(exampleNodesWithNothingRunning()).client);
    const nav = await screen.findByRole("navigation", { name: "Views" });

    fireEvent.click(within(nav).getByRole("button", { name: "Tasks" }));

    expect(await screen.findByRole("list", { name: "Tasks" })).toBeDefined();
  });

  test("start_mode_colorsTheWholeScreenAndSetsItsLength", async () => {
    renderApp(recordingClient(exampleNodesWithNothingRunning()).client);
    await screen.findByRole("button", { name: "Start" });

    expect(screenRoot().dataset.mode).toBe("deep");
    expect(
      screen
        .getByRole("radio", { name: "Deep Focus" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(length()).toBe("90:00");

    fireEvent.click(screen.getByRole("radio", { name: "Execution" }));

    expect(screenRoot().dataset.mode).toBe("execution");
    expect(length()).toBe("50:00");
    fireEvent.click(screen.getByRole("radio", { name: "Shallow" }));
    expect(screenRoot().dataset.mode).toBe("shallow");
    expect(length()).toBe("25:00");
  });

  test("start_stepper_movesByFiveAndStopsAtFive", async () => {
    renderApp(recordingClient(exampleNodesWithNothingRunning()).client);
    await screen.findByRole("button", { name: "Start" });
    fireEvent.click(screen.getByRole("radio", { name: "Shallow" }));

    fireEvent.click(screen.getByRole("button", { name: "Five minutes more" }));
    expect(length()).toBe("30:00");
    Array.from({ length: 10 }).forEach(() =>
      fireEvent.click(
        screen.getByRole("button", { name: "Five minutes less" }),
      ),
    );

    expect(length()).toBe("5:00");
  });

  test("start_strip_showsTheMostRecentlyWorkedTask", async () => {
    renderApp(recordingClient(exampleNodesWithNothingRunning()).client);
    await screen.findByRole("button", { name: "Start" });

    expect(screen.getByText("Working on")).toBeDefined();
    expect(
      screen.getByText("Notes", { selector: ".task-strip-name" }),
    ).toBeDefined();
    expect(screen.getByText("Book / Chapter 1")).toBeDefined();
    expect(screen.getByTestId("strip-time").textContent).toBe("50m so far");
  });

  test("start_stripForAnEstimatedTask_showsItsPlannedTime", async () => {
    renderApp(recordingClient(exampleNodesWithNothingRunning()).client);

    await openOnStart("Book");

    expect(screen.getByTestId("strip-time").textContent).toBe(
      "4h 35m of 7h 30m planned",
    );
  });

  test("start_start_usesTheStripTaskTheModeAndTheLength", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    const create = vi.spyOn(recording.client, "createCycle");
    renderApp(recording.client);
    await screen.findByRole("button", { name: "Start" });
    fireEvent.click(screen.getByRole("radio", { name: "Execution" }));
    fireEvent.click(screen.getByRole("button", { name: "Five minutes more" }));

    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await screen.findByRole("timer", { name: "Time left" });
    expect(create.mock.calls[0][0]).toMatchObject({
      nodeId: NOTES,
      mode: FocusMode.EXECUTION,
      plannedMinutes: 55,
    });
  });

  test("start_takeABreak_opensTheBreak", async () => {
    renderApp(recordingClient(exampleNodesWithNothingRunning()).client);
    await screen.findByRole("button", { name: "Start" });

    fireEvent.click(screen.getByRole("button", { name: "Take a break" }));

    expect(
      await screen.findByRole("radiogroup", { name: "What kind of break" }),
    ).toBeDefined();
  });

  test("start_noTask_showsTheEmptyStrip", () => {
    render(
      <StartScreen
        data={exampleData()}
        timeZone="UTC"
        busy={false}
        initialNodeId={INBOX_ID}
        onStart={() => {}}
        onBreak={() => {}}
        onSaveTask={async () => undefined}
        onOpenTasks={() => {}}
        onSignOut={() => {}}
      />,
    );

    expect(screen.getByText("What are you working on?")).toBeDefined();
    expect(screen.queryByText("Working on")).toBeNull();
    expect(screen.getByTestId("strip-time").textContent).toBe("");
  });
});

describe("taskStrip", () => {
  test.each([
    [BOOK, { name: "Book", path: [], timeLine: "4h 35m of 7h 30m planned" }],
    [
      NOTES,
      { name: "Notes", path: ["Book", "Chapter 1"], timeLine: "50m so far" },
    ],
    [INBOX_ID, undefined],
    ["no-such-node", undefined],
  ])("taskStrip_%s", (nodeId, expected) => {
    expect(taskStrip(exampleData(), nodeId)).toEqual(expected);
  });
});
