import { fireEvent, render, screen, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "../App";
import type { LedgerClient } from "../api/ledgerClient";
import { FocusMode } from "../gen/focusledger/v1/model_pb";
import { exampleNow } from "../ledger/exampleData";
import { findRow, taskTree } from "../tasks/tasksModel";
import {
  exampleNodesWithNothingRunning,
  recordingClient,
} from "../testing/appHarness";
import { openTasks } from "../testing/navigation";
import {
  chartHours,
  estimateFigures,
  lastSevenDays,
  ringParts,
} from "./taskPageModel";

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

function bookRow(nodeId = BOOK) {
  const row = findRow(taskTree(exampleNodesWithNothingRunning()), nodeId);
  if (!row) throw new Error("missing row");
  return row;
}

describe("Task page model", () => {
  test("estimateFigures_rollUpTheSubtreePerMode", () => {
    const figures = estimateFigures(bookRow());

    expect(figures.logged).toBe(490);
    expect(figures.estimate).toBe(1825);
    expect(figures.onParts).toBe(1375);
    expect(figures.byMode[FocusMode.DEEP_FOCUS]).toEqual({
      logged: 335,
      estimate: 450,
    });
    expect(figures.byMode[FocusMode.EXECUTION]).toEqual({
      logged: 100,
      estimate: 1000,
    });
    expect(figures.byMode[FocusMode.SHALLOW]).toEqual({
      logged: 55,
      estimate: 375,
    });
  });

  test("ringParts_areTheLeavesWithTheRestInOthers", () => {
    expect(
      ringParts(bookRow()).map((part) => [part.name, part.minutes]),
    ).toEqual([
      ["Others", 385],
      ["Chapter 2", 55],
      ["Notes", 50],
    ]);
  });

  test("ringParts_taskWithoutChildren_splitsByMode", () => {
    expect(
      ringParts(bookRow(NOTES)).map((part) => [part.name, part.minutes]),
    ).toEqual([["Execution", 50]]);
  });

  test("ringParts_moreThanFiveLeaves_groupsTheSmallestInOthers", () => {
    const nodes = exampleNodesWithNothingRunning();
    const book = bookRow();
    const leaves = [10, 20, 30, 40, 50, 60].map((minutes, index) => ({
      ...book.node,
      id: `leaf-${index}`,
      name: `Leaf ${index}`,
      parentId: BOOK,
      estimates: [],
      cycles: [{ ...book.node.cycles[0], id: `cycle-${index}`, minutes }],
    }));
    const row = findRow(taskTree([...nodes, ...leaves]), BOOK);
    if (!row) throw new Error("missing row");

    const parts = ringParts(row);

    expect(parts.filter((part) => part.name !== "Others")).toHaveLength(5);
    expect(parts.map((part) => part.name)).not.toContain("Leaf 0");
    expect(parts.reduce((sum, part) => sum + part.minutes, 0)).toBe(
      row.rollUp.rolledUp.minutes,
    );
  });

  test("lastSevenDays_endTodayWithTheSubtreeMinutesPerDay", () => {
    const days = lastSevenDays(bookRow(), exampleNow, "UTC");

    expect(days.map((day) => day.total)).toEqual([110, 0, 60, 0, 0, 30, 125]);
    expect(days.map((day) => day.isToday)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    ]);
    expect(days[6].byMode[FocusMode.EXECUTION]).toBe(50);
    expect(chartHours(days)).toBe(3);
  });
});

async function openTaskPage(client: LedgerClient, name: string) {
  render(
    <StrictMode>
      <App client={client} timeZone="UTC" retryDelaysMs={[0]} />
    </StrictMode>,
  );
  await screen.findByRole("button", { name: "Start" });
  await openTasks();
  fireEvent.click(await screen.findByRole("listitem", { name }));
  const nameButton = await screen.findByRole("button", {
    name: `Edit task, ${name}`,
  });
  return nameButton.closest("h1") as HTMLElement;
}

async function nodeNamed(client: LedgerClient, name: string) {
  const { nodes } = await client.listNodes({ includeClosed: true });
  return nodes.find((node) => node.name === name);
}

describe("Task page", () => {
  test("taskPage_rowClick_showsTheTaskWithItsPath", async () => {
    const heading = await openTaskPage(
      recordingClient(exampleNodesWithNothingRunning()).client,
      "Notes",
    );

    expect(heading.textContent).toBe("Notes");
    expect(screen.getByText("Book / Chapter 1")).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Edit task, Notes" }),
    ).toBeDefined();
  });

  test("taskPage_back_returnsToTheTable", async () => {
    await openTaskPage(
      recordingClient(exampleNodesWithNothingRunning()).client,
      "Notes",
    );

    fireEvent.click(screen.getByRole("button", { name: "Back to tasks" }));

    expect(screen.getByRole("listitem", { name: "Book" })).toBeDefined();
  });

  test("taskPage_markCompleteThenCompleted_setsAndClearsClosed", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await openTaskPage(recording.client, "Admin");

    fireEvent.click(screen.getByRole("button", { name: "Mark complete" }));
    const completed = await screen.findByRole("button", { name: "Completed" });
    expect(completed.getAttribute("aria-pressed")).toBe("true");
    expect((await nodeNamed(recording.client, "Admin"))?.closed).toBe(true);

    fireEvent.click(completed);
    await screen.findByRole("button", { name: "Mark complete" });

    expect((await nodeNamed(recording.client, "Admin"))?.closed).toBe(false);
    expect(recording.updateNodeMasks).toEqual([["closed"], ["closed"]]);
  });

  test("taskPage_estimate_showsTheRollUpAndThePartsLine", async () => {
    await openTaskPage(
      recordingClient(exampleNodesWithNothingRunning()).client,
      "Book",
    );
    const card = within(screen.getByRole("region", { name: "Estimate" }));

    expect(card.getByText("8h 10m")).toBeDefined();
    expect(card.getByText("of 30h 25m")).toBeDefined();
    expect(card.getByText("27%")).toBeDefined();
    expect(
      card.getByText("Includes 22h 55m estimated on the parts"),
    ).toBeDefined();
  });

  test("taskPage_editEstimate_savesTheOwnRowsWithTheEstimatesMask", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await openTaskPage(recording.client, "Book");
    const card = within(screen.getByRole("region", { name: "Estimate" }));

    fireEvent.click(card.getByRole("button", { name: "Edit estimate" }));
    expect(card.getByText("estimated in total")).toBeDefined();
    expect(card.getByText("7h 30m")).toBeDefined();
    fireEvent.click(card.getByRole("button", { name: "Shallow cycles: more" }));
    fireEvent.click(card.getByRole("button", { name: "Save" }));

    await vi.waitFor(() =>
      expect(card.getByRole("button", { name: "Edit estimate" })).toBeDefined(),
    );
    expect(recording.updateNodeMasks).toEqual([["estimates"]]);
    const book = await nodeNamed(recording.client, "Book");
    expect(
      book?.estimates.map(({ mode, cycleMinutes, cycleCount }) => [
        mode,
        cycleMinutes,
        cycleCount,
      ]),
    ).toEqual([
      [FocusMode.DEEP_FOCUS, 90, 5],
      [FocusMode.SHALLOW, 25, 1],
    ]);
  });

  test("taskPage_cancelEstimate_writesNothing", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await openTaskPage(recording.client, "Book");
    const card = within(screen.getByRole("region", { name: "Estimate" }));

    fireEvent.click(card.getByRole("button", { name: "Edit estimate" }));
    fireEvent.click(
      card.getByRole("button", { name: "Deep Focus cycles: more" }),
    );
    fireEvent.click(card.getByRole("button", { name: "Cancel" }));

    expect(card.getByText("of 30h 25m")).toBeDefined();
    expect(recording.updateNodeMasks).toEqual([]);
  });

  test("taskPage_nameButton_opensEditTaskAndRenames", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await openTaskPage(recording.client, "Admin");

    fireEvent.click(screen.getByRole("button", { name: "Edit task, Admin" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Task name" }), {
      target: { value: "Paperwork" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByRole("button", { name: "Edit task, Paperwork" }),
    ).toBeDefined();
    expect(recording.updateNodeMasks).toEqual([["name"]]);
  });

  test("taskPage_split_listsThePartsWithTheirShare", async () => {
    await openTaskPage(
      recordingClient(exampleNodesWithNothingRunning()).client,
      "Book",
    );
    const card = within(
      screen.getByRole("region", { name: "How it splits across Book" }),
    );

    expect(
      card.getAllByRole("listitem").map((item) => item.textContent),
    ).toEqual(["Others6h 25m79%", "Chapter 255m11%", "Notes50m10%"]);
    expect(card.getByText("across 3 parts")).toBeDefined();
  });

  test("taskPage_splitHover_showsThePartByMode", async () => {
    await openTaskPage(
      recordingClient(exampleNodesWithNothingRunning()).client,
      "Book",
    );
    const card = within(
      screen.getByRole("region", { name: "How it splits across Book" }),
    );

    fireEvent.mouseEnter(card.getAllByRole("listitem")[1]);

    const tip = card.getByRole("tooltip");
    expect(tip.textContent).toContain("Chapter 2");
    expect(tip.textContent).toContain("Shallow55m");
    expect(tip.textContent).toContain("Deep Focus0m");
  });

  async function openDays() {
    await openTaskPage(
      recordingClient(exampleNodesWithNothingRunning()).client,
      "Book",
    );
    const card = within(
      screen.getByRole("region", { name: "Last seven days" }),
    );
    return { card, bars: card.getAllByRole("listitem") };
  }

  function dimmed(bars: HTMLElement[]) {
    return bars.map((bar) => bar.getAttribute("data-dim"));
  }

  test("days_atRest_showNoFigureAboveTheBars", async () => {
    const { card, bars } = await openDays();

    expect(bars.map((bar) => bar.textContent)).toEqual([
      "",
      "—",
      "",
      "—",
      "—",
      "",
      "",
    ]);
    expect(card.queryByRole("tooltip")).toBeNull();
    expect(new Set(dimmed(bars))).toEqual(new Set(["false"]));
  });

  test("days_hover_keepsTheBarFadesTheOthersAndShowsTheCard", async () => {
    const { card, bars } = await openDays();

    fireEvent.mouseEnter(bars[0]);

    const tip = card.getByRole("tooltip");
    expect(tip.textContent).toContain("Mon 26");
    expect(tip.textContent).toContain("1h 50m");
    expect(tip.textContent).toContain("Deep Focus1h 50m");
    expect(tip.textContent).toContain("Shallow0m");
    expect(dimmed(bars)).toEqual([
      "false",
      "true",
      "true",
      "true",
      "true",
      "true",
      "true",
    ]);
    fireEvent.mouseLeave(bars[0]);
    expect(card.queryByRole("tooltip")).toBeNull();
  });

  test("days_keyboardFocus_showsTheCardForThatDay", async () => {
    const { card, bars } = await openDays();

    fireEvent.focus(bars[6]);

    expect(card.getByRole("tooltip").textContent).toContain("Today");
    expect(card.getByRole("tooltip").textContent).toContain("2h 05m");
    expect(card.getByRole("tooltip").textContent).toContain("Execution50m");
    fireEvent.blur(bars[6]);
    expect(card.queryByRole("tooltip")).toBeNull();
  });

  test("days_tap_togglesTheCard", async () => {
    const { card, bars } = await openDays();

    fireEvent.click(bars[5]);
    expect(card.getByRole("tooltip").textContent).toContain("Sat 31");
    expect(card.getByRole("tooltip").textContent).toContain("30m");

    fireEvent.click(bars[5]);
    expect(card.queryByRole("tooltip")).toBeNull();
  });

  test("taskPage_lastSevenDays_labelsTheDaysAndTheTotals", async () => {
    await openTaskPage(
      recordingClient(exampleNodesWithNothingRunning()).client,
      "Book",
    );
    const card = within(
      screen.getByRole("region", { name: "Last seven days" }),
    );

    expect(
      card
        .getAllByRole("listitem")
        .map((item) => item.getAttribute("aria-label")),
    ).toEqual([
      "Mon 26: 1h 50m",
      "Tue 27: nothing",
      "Wed 28: 1h 00m",
      "Thu 29: nothing",
      "Fri 30: nothing",
      "Sat 31: 30m",
      "Today: 2h 05m",
    ]);
    expect(card.getByText("5h 25m this week")).toBeDefined();
  });
});
