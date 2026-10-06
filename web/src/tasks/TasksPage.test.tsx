import { fireEvent, render, screen, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "../App";
import type { Ledger } from "../api/ledger";
import type { CyclePb } from "../gen/focusledger/v1/model_pb";
import { exampleNow } from "../ledger/exampleData";
import {
  exampleNodesWithNothingRunning,
  recordingClient,
} from "../testing/appHarness";
import { openTasks } from "../testing/navigation";

const NOTES = "00000000-0000-4000-8000-00000000000d";
const ADMIN = "00000000-0000-4000-8000-00000000000e";
const INBOX_SHALLOW = "00000000-0000-4000-8000-0000000000f1";

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(exampleNow);
});

afterEach(() => {
  vi.useRealTimers();
});

async function openTasksPage(client: Ledger) {
  render(
    <StrictMode>
      <App client={client} timeZone="UTC" retryDelaysMs={[0]} />
    </StrictMode>,
  );
  await screen.findByRole("button", { name: "Start" });
  await openTasks();
  await screen.findByRole("listitem", { name: "Book" });
}

function row(name: string) {
  return screen.getByRole("listitem", { name });
}

function cells(name: string) {
  const item = row(name);
  const line = item.classList.contains("tasks-row")
    ? item
    : (item.querySelector(".tasks-row") as HTMLElement);
  return [...line.querySelectorAll(":scope > span")].map(
    (cell) => cell.textContent,
  );
}

function rowNames() {
  return within(screen.getByRole("list", { name: "Tasks" }))
    .getAllByRole("listitem")
    .filter((item) => item.classList.contains("tasks-row"))
    .map((item) => item.getAttribute("aria-label"));
}

function drag(from: HTMLElement, onto: HTMLElement) {
  fireEvent.dragStart(from);
  const allowed = !fireEvent.dragOver(onto);
  fireEvent.drop(onto);
  return allowed;
}

async function parentOf(client: Ledger, name: string) {
  const { nodes } = await client.listNodes({ includeClosed: true });
  const node = nodes.find((listed) => listed.name === name);
  return nodes.find((listed) => listed.id === node?.parentId)?.name;
}

async function allCycles(client: Ledger): Promise<CyclePb[]> {
  const { nodes } = await client.listNodes({ includeClosed: true });
  return nodes.flatMap((node) => node.cycles);
}

function expandUntagged() {
  fireEvent.click(screen.getByRole("button", { name: "Expand Untagged" }));
  return within(screen.getByRole("list", { name: "Untagged cycles" }));
}

describe("Tasks page", () => {
  test("tasks_rows_showLoggedEstimateAndLastWorked", async () => {
    await openTasksPage(
      recordingClient(exampleNodesWithNothingRunning()).client,
    );

    expect(rowNames()).toEqual([
      "Book",
      "Chapter 1",
      "Notes",
      "Chapter 2",
      "Admin",
    ]);
    expect(cells("Book")).toEqual([
      "Book",
      "8h 10m",
      "30h 25m",
      "10 h ago",
      "",
    ]);
    expect(cells("Notes")).toEqual(["Notes", "50m", "", "10 h ago", ""]);
    expect(cells("Admin")).toEqual(["Admin", "", "", "", ""]);
  });

  test("tasks_completedTask_isListedMutedAndCannotBeDragged", async () => {
    await openTasksPage(
      recordingClient(exampleNodesWithNothingRunning()).client,
    );

    const completed = row("Chapter 2");
    expect(completed.getAttribute("data-closed")).toBe("true");
    expect(completed.textContent).not.toContain("Completed");
    expect(completed.getAttribute("draggable")).toBe("false");
  });

  test("tasks_overEstimate_marksTheEstimate", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await recording.client.updateNode({
      nodeId: NOTES,
      estimates: [{ mode: 2, cycleMinutes: 25, cycleCount: 1 }],
      updateMask: { paths: ["estimates"] },
    });
    await openTasksPage(recording.client);

    const estimate = row("Notes").querySelector(".tasks-estimate");
    expect(estimate?.textContent).toBe("25m");
    expect(estimate?.getAttribute("data-over")).toBe("true");
    expect(
      row("Book").querySelector(".tasks-estimate")?.hasAttribute("data-over"),
    ).toBe(false);
  });

  test("tasks_collapse_hidesTheSubtreeAndExpandShowsIt", async () => {
    await openTasksPage(
      recordingClient(exampleNodesWithNothingRunning()).client,
    );

    fireEvent.click(screen.getByRole("button", { name: "Collapse Book" }));
    expect(rowNames()).toEqual(["Book", "Admin"]);

    fireEvent.click(screen.getByRole("button", { name: "Expand Book" }));
    expect(rowNames()).toHaveLength(5);
  });

  test("tasks_untagged_listsTheInboxCyclesNewestFirst", async () => {
    await openTasksPage(
      recordingClient(exampleNodesWithNothingRunning()).client,
    );

    expect(cells("Untagged")[1]).toBe("1h 15m");
    const cycles = expandUntagged();

    expect(
      cycles.getAllByRole("listitem").map((item) => item.textContent),
    ).toEqual(["Shallow25mToday 07:30", "Execution50m20 Oct 10:00"]);
  });

  test("tasks_untaggedOverFive_showsTheOlderOnesOnClick", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await Promise.all(
      [1, 2, 3, 4, 5].map((hour) =>
        recording.client.createCycle({
          requestId: crypto.randomUUID(),
          mode: 3,
          plannedMinutes: 25,
          minutes: 25,
          startedAt: {
            seconds: BigInt(
              Math.floor((exampleNow.getTime() - hour * 3_600_000) / 1000),
            ),
            nanos: 0,
          },
        }),
      ),
    );
    await openTasksPage(recording.client);
    const cycles = expandUntagged();

    expect(cycles.getAllByRole("listitem")).toHaveLength(6);
    fireEvent.click(cycles.getByRole("button", { name: "2 older" }));

    expect(cycles.getAllByRole("listitem")).toHaveLength(7);
  });

  test("tasks_newTask_createsATopLevelTask", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await openTasksPage(recording.client);

    fireEvent.click(screen.getByRole("button", { name: "New task" }));
    expect(
      within(screen.getByRole("dialog", { name: "New task" })).getByRole(
        "button",
        { name: /^Parent/ },
      ).textContent,
    ).toContain("None");
    fireEvent.change(screen.getByRole("textbox", { name: "Task name" }), {
      target: { value: "Taxes" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(
      await screen.findByRole("listitem", { name: "Taxes" }),
    ).toBeDefined();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await parentOf(recording.client, "Taxes")).toBeUndefined();
  });

  test("tasks_rowClick_opensTheTaskPage", async () => {
    await openTasksPage(
      recordingClient(exampleNodesWithNothingRunning()).client,
    );

    fireEvent.click(row("Admin"));

    expect(
      screen.getByRole("button", { name: "Edit task, Admin" }),
    ).toBeDefined();
    expect(screen.queryByRole("list", { name: "Tasks" })).toBeNull();
  });

  test("tasks_chevronClick_doesNotOpenTheTaskPage", async () => {
    await openTasksPage(
      recordingClient(exampleNodesWithNothingRunning()).client,
    );

    fireEvent.click(screen.getByRole("button", { name: "Collapse Book" }));

    expect(screen.getByRole("list", { name: "Tasks" })).toBeDefined();
    expect(screen.queryByRole("button", { name: /^Edit task/ })).toBeNull();
  });

  test("tasks_header_opensReportSettingsAndStart", async () => {
    await openTasksPage(
      recordingClient(exampleNodesWithNothingRunning()).client,
    );
    const nav = screen.getByRole("navigation", { name: "Views" });
    expect(
      within(nav)
        .getByRole("button", { name: "Tasks" })
        .getAttribute("aria-current"),
    ).toBe("page");

    fireEvent.click(screen.getByRole("button", { name: /back to Start/ }));

    expect(await screen.findByRole("button", { name: "Start" })).toBeDefined();
  });
});

describe("Drag a task", () => {
  test("drag_taskWithoutCycles_movesAtOnce", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await openTasksPage(recording.client);

    expect(drag(row("Admin"), row("Book"))).toBe(true);

    await vi.waitFor(async () =>
      expect(await parentOf(recording.client, "Admin")).toBe("Book"),
    );
    expect(recording.updateNodeMasks).toEqual([["parent_id"]]);
  });

  test("drag_taskWithCycles_movesAtOnceWithNoConfirm", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await openTasksPage(recording.client);

    expect(drag(row("Chapter 1"), row("Admin"))).toBe(true);

    expect(screen.queryByRole("alertdialog")).toBeNull();
    await vi.waitFor(async () =>
      expect(await parentOf(recording.client, "Chapter 1")).toBe("Admin"),
    );
    expect(recording.updateNodeMasks).toEqual([["parent_id"]]);
  });

  test("drag_ontoItselfItsSubtreeOrCurrentParent_isNotADropTarget", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await openTasksPage(recording.client);

    expect(drag(row("Book"), row("Book"))).toBe(false);
    expect(drag(row("Book"), row("Notes"))).toBe(false);
    expect(drag(row("Notes"), row("Chapter 1"))).toBe(false);
    expect(recording.updateNodeMasks).toEqual([]);
  });

  test("drag_ontoACompletedTask_isNotADropTarget", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await openTasksPage(recording.client);

    expect(drag(row("Admin"), row("Chapter 2"))).toBe(false);
    expect(recording.updateNodeMasks).toEqual([]);
  });

  test("drag_ontoTheTopLevelZone_makesTheTaskARoot", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await openTasksPage(recording.client);

    fireEvent.dragStart(row("Notes"));
    const zone = screen.getByText("Move to the top level");
    fireEvent.dragOver(zone);
    fireEvent.drop(zone);

    await vi.waitFor(async () =>
      expect(await parentOf(recording.client, "Notes")).toBeUndefined(),
    );
  });

  test("drag_topLevelTask_hasNoTopLevelZone", async () => {
    await openTasksPage(
      recordingClient(exampleNodesWithNothingRunning()).client,
    );

    fireEvent.dragStart(row("Admin"));

    expect(screen.queryByText("Move to the top level")).toBeNull();
  });
});

describe("Drag an Untagged cycle", () => {
  test("file_dropOnATask_setsTheCycleNodeWithTheNodeIdMask", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await openTasksPage(recording.client);
    const cycles = expandUntagged();

    expect(drag(cycles.getAllByRole("listitem")[0], row("Admin"))).toBe(true);

    await vi.waitFor(() =>
      expect(
        screen.getByRole("list", { name: "Untagged cycles" }).children,
      ).toHaveLength(1),
    );
    expect(recording.updateCycleMasks).toEqual([["node_id"]]);
    const filed = (await allCycles(recording.client)).find(
      (cycle) => cycle.id === INBOX_SHALLOW,
    );
    expect(filed?.nodeId).toBe(ADMIN);
  });

  test("file_ontoACompletedTask_isNotADropTarget", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await openTasksPage(recording.client);
    const cycles = expandUntagged();

    expect(drag(cycles.getAllByRole("listitem")[0], row("Chapter 2"))).toBe(
      false,
    );
    expect(recording.updateCycleMasks).toEqual([]);
  });

  test("file_secondFiling_showsTheErrorAndKeepsTheFirstNode", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await openTasksPage(recording.client);
    const cycles = expandUntagged();
    await recording.client.updateCycle({
      cycleId: INBOX_SHALLOW,
      nodeId: ADMIN,
      updateMask: { paths: ["node_id"] },
    });

    drag(cycles.getAllByRole("listitem")[0], row("Book"));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "already filed",
    );
    const filed = (await allCycles(recording.client)).find(
      (cycle) => cycle.id === INBOX_SHALLOW,
    );
    expect(filed?.nodeId).toBe(ADMIN);
  });
});

describe("Empty", () => {
  test("tasks_noTasks_showsTheEmptyState", async () => {
    const recording = recordingClient([]);
    await recording.client.createCycle({
      requestId: crypto.randomUUID(),
      mode: 3,
      plannedMinutes: 25,
      minutes: 25,
      startedAt: {
        seconds: BigInt(Math.floor(exampleNow.getTime() / 1000) - 3600),
        nanos: 0,
      },
    });
    render(
      <StrictMode>
        <App client={recording.client} timeZone="UTC" retryDelaysMs={[0]} />
      </StrictMode>,
    );
    await screen.findByRole("button", { name: "Start" });
    await openTasks();

    expect(await screen.findByText("No tasks yet")).toBeDefined();
    expect(
      screen.getByText("Cycles you run without picking a task land here."),
    ).toBeDefined();
  });
});
