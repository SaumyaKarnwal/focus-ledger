import { create } from "@bufbuild/protobuf";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "../App";
import type { LedgerClient } from "../api/ledgerClient";
import {
  FocusMode,
  NodePbSchema,
  SettingsPbSchema,
} from "../gen/focusledger/v1/model_pb";
import { exampleNodes, exampleNow } from "../ledger/exampleData";
import { weekRange } from "../ledger/period";
import {
  exampleNodesWithNothingRunning,
  recordingClient,
} from "../testing/appHarness";
import type { TodayData } from "../today/todayModel";
import { inboxMinutesToday, inboxMode, pickerRows } from "./pickerModel";

const BOOK = "00000000-0000-4000-8000-00000000000a";

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

async function openPicker(client: LedgerClient) {
  renderApp(client);
  await screen.findByRole("button", { name: "Start" });
  fireEvent.click(screen.getByRole("button", { name: /working on/i }));
  return screen.getByRole("dialog", { name: "Choose a task" });
}

function search() {
  return screen.getByRole("combobox");
}

function optionNames() {
  return within(screen.getByRole("listbox", { name: "Tasks" }))
    .getAllByRole("option")
    .map((option) => option.querySelector(".picker-name")?.textContent);
}

function highlighted() {
  return within(screen.getByRole("listbox", { name: "Tasks" }))
    .getAllByRole("option")
    .find((option) => option.getAttribute("aria-selected") === "true")
    ?.querySelector(".picker-name")?.textContent;
}

function stripName() {
  return document.querySelector(".task-strip-name")?.textContent ?? null;
}

describe("Task picker", () => {
  test("picker_open_listsOpenTasksByLastWorkThenNotSureYet", async () => {
    const dialog = await openPicker(
      recordingClient(exampleNodesWithNothingRunning()).client,
    );

    expect(document.activeElement).toBe(search());
    expect(optionNames()).toEqual([
      "Notes",
      "Book",
      "Chapter 1",
      "Admin",
      "Not sure yet",
    ]);
    expect(highlighted()).toBe("Notes");
    expect(
      within(dialog).getByText("Book / Chapter 1 · 10h ago"),
    ).toBeDefined();
    expect(within(dialog).getByText("4h 35m / 7h 30m")).toBeDefined();
    expect(within(dialog).getByText("New task")).toBeDefined();
  });

  test("picker_completedTasks_areNotListed", async () => {
    const { client } = recordingClient(exampleNodesWithNothingRunning());
    await client.updateNode({
      nodeId: "00000000-0000-4000-8000-00000000000b",
      closed: true,
      updateMask: { paths: ["closed"] },
    });

    await openPicker(client);

    expect(optionNames()).toEqual(["Book", "Admin", "Not sure yet"]);
  });

  test("picker_typing_filtersByNameOrPath", async () => {
    await openPicker(recordingClient(exampleNodesWithNothingRunning()).client);

    fireEvent.change(search(), { target: { value: "chapter" } });
    expect(optionNames()).toEqual(["Notes", "Chapter 1", "Not sure yet"]);

    fireEvent.change(search(), { target: { value: "zzz" } });
    expect(optionNames()).toEqual(["Not sure yet"]);
    expect(screen.getByText("No task matches “zzz”.")).toBeDefined();
  });

  test("picker_arrowsAndEnter_pickTheHighlightedTask", async () => {
    await openPicker(recordingClient(exampleNodesWithNothingRunning()).client);

    fireEvent.keyDown(search(), { key: "ArrowDown" });
    fireEvent.keyDown(search(), { key: "ArrowDown" });
    expect(highlighted()).toBe("Chapter 1");
    fireEvent.keyDown(search(), { key: "ArrowUp" });
    expect(highlighted()).toBe("Book");
    fireEvent.keyDown(search(), { key: "Enter" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(stripName()).toBe("Book");
    expect(screen.getByTestId("strip-time").textContent).toBe(
      "4h 35m of 7h 30m planned",
    );
  });

  test("picker_arrows_stopAtTheEnds", async () => {
    await openPicker(recordingClient(exampleNodesWithNothingRunning()).client);

    fireEvent.keyDown(search(), { key: "ArrowUp" });
    expect(highlighted()).toBe("Notes");
    Array.from({ length: 9 }).forEach(() =>
      fireEvent.keyDown(search(), { key: "ArrowDown" }),
    );
    expect(highlighted()).toBe("Not sure yet");
  });

  test("picker_escape_closesWithoutAChange", async () => {
    await openPicker(recordingClient(exampleNodesWithNothingRunning()).client);
    fireEvent.keyDown(search(), { key: "ArrowDown" });

    fireEvent.keyDown(search(), { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(stripName()).toBe("Notes");
  });

  test("picker_clickOnTheScrim_closesIt", async () => {
    await openPicker(recordingClient(exampleNodesWithNothingRunning()).client);

    fireEvent.mouseDown(document.querySelector(".picker-scrim") as Element);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("picker_clickATask_picksIt", async () => {
    await openPicker(recordingClient(exampleNodesWithNothingRunning()).client);

    fireEvent.click(screen.getByText("Admin", { selector: ".picker-name" }));

    expect(stripName()).toBe("Admin");
  });

  test("picker_notSureYet_startsACycleWithNoNode", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    const createCycle = vi.spyOn(recording.client, "createCycle");
    await openPicker(recording.client);

    fireEvent.click(screen.getByText("Not sure yet"));
    expect(screen.getByText("What are you working on?")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await screen.findByRole("timer", { name: "Time left" });
    expect(createCycle.mock.calls[0][0].nodeId).toBeUndefined();
    const { nodes } = await recording.client.listNodes({});
    const running = nodes
      .flatMap((node) => node.cycles)
      .find((cycle) => cycle.minutes === undefined);
    expect(running?.nodeId).toBeUndefined();
    expect(
      screen.getByText("Not sure yet", { selector: ".task-strip-name" }),
    ).toBeDefined();
  });

  test("picker_newTask_opensTheNewTaskDialog", async () => {
    await openPicker(recordingClient(exampleNodesWithNothingRunning()).client);

    fireEvent.click(screen.getByRole("button", { name: "New task" }));

    expect(screen.getByRole("dialog", { name: "New task" })).toBeDefined();
    expect(screen.queryByRole("dialog", { name: "Choose a task" })).toBeNull();
  });

  test("picker_newAccount_showsOnlyNotSureYet", async () => {
    // A new account: no task and no cycle (board C-Desk-Start-Pick-Empty).
    await openPicker(recordingClient([], {}).client);

    expect(optionNames()).toEqual(["Not sure yet"]);
    expect(highlighted()).toBe("Not sure yet");
  });
});

function exampleData(): TodayData {
  return {
    email: "fake.user@example.com",
    settings: create(SettingsPbSchema),
    allTimeNodes: exampleNodesWithNothingRunning().filter(
      (node) => !node.closed,
    ),
    weekNodes: exampleNodes(),
    week: weekRange(exampleNow, "UTC"),
  };
}

describe("pickerModel", () => {
  test("pickerRows_example_carryDetailFigureAndMode", () => {
    const [notes, book, , admin] = pickerRows(
      exampleData(),
      exampleNow,
      "UTC",
      "",
    );

    expect(notes).toEqual({
      nodeId: "00000000-0000-4000-8000-00000000000d",
      name: "Notes",
      detail: "Book / Chapter 1 · 10h ago",
      figure: "50m",
      mode: FocusMode.EXECUTION,
    });
    expect(book).toMatchObject({ nodeId: BOOK, mode: FocusMode.DEEP_FOCUS });
    expect(admin).toMatchObject({
      detail: "no cycles yet",
      figure: "0m",
      mode: undefined,
    });
  });

  test("pickerRows_tasksWithCyclesFirst_thenNoCyclesNewestCreatedFirst", () => {
    const data = exampleData();
    const createdMinutesAgo = (minutes: number) => ({
      seconds: BigInt(
        Math.floor((exampleNow.getTime() - minutes * 60_000) / 1000),
      ),
      nanos: 0,
    });
    // Taxes is newer than every cycle, so it used to rise to the top.
    const taxes = create(NodePbSchema, {
      id: "taxes",
      name: "Taxes",
      createdAt: createdMinutesAgo(1),
    });
    const reading = create(NodePbSchema, {
      id: "reading",
      name: "Reading",
      createdAt: createdMinutesAgo(30 * 24 * 60),
    });
    data.allTimeNodes = [...data.allTimeNodes, reading, taxes];

    const rows = pickerRows(data, exampleNow, "UTC", "");
    const noCycles = (row: { detail: string }) =>
      row.detail.endsWith("no cycles yet");

    expect(rows.map((row) => row.name)).toEqual([
      "Notes",
      "Book",
      "Chapter 1",
      "Taxes",
      "Admin",
      "Reading",
    ]);
    expect(rows.slice(0, 3).some(noCycles)).toBe(false);
    expect(rows.slice(3).every(noCycles)).toBe(true);
    expect(
      pickerRows(data, exampleNow, "UTC", "a").map((row) => row.name),
    ).toEqual(
      ["Notes", "Book", "Chapter 1", "Taxes", "Admin", "Reading"].filter(
        (name) =>
          rows
            .find((row) => row.name === name)
            ?.detail.concat(name)
            .toLowerCase()
            .includes("a"),
      ),
    );
  });

  test("inboxRow_example_hasTodaysMinutesAndTheLatestMode", () => {
    expect(inboxMinutesToday(exampleData(), exampleNow, "UTC")).toBe(25);
    expect(inboxMode(exampleData())).toBe(FocusMode.SHALLOW);
  });
});
