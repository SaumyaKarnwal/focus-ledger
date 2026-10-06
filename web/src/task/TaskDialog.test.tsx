import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "../App";
import type { LedgerClient } from "../api/ledgerClient";
import {
  FocusMode,
  type NodePb,
  SettingsPbSchema,
} from "../gen/focusledger/v1/model_pb";
import { exampleNodes, exampleNow } from "../ledger/exampleData";
import {
  exampleNodesWithNothingRunning,
  recordingClient,
} from "../testing/appHarness";
import type { TodayData } from "../today/todayModel";
import { writeTask } from "./saveTask";
import { TaskDialog } from "./TaskDialog";
import { filterParentRows, parentLabel, parentRows } from "./taskDialogModel";

const BOOK = "00000000-0000-4000-8000-00000000000a";
const CHAPTER_1 = "00000000-0000-4000-8000-00000000000b";

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(exampleNow);
});

afterEach(() => {
  vi.useRealTimers();
});

function dataOf(nodes: NodePb[]): TodayData {
  return {
    weekNodes: nodes,
    allTimeNodes: nodes,
    settings: create(SettingsPbSchema, {
      deepFocusMinutes: 90,
      executionMinutes: 50,
      shallowMinutes: 25,
      breakMinutes: 5,
    }),
    email: "test@example.com",
  } as TodayData;
}

function renderApp(client: LedgerClient) {
  return render(
    <StrictMode>
      <App client={client} timeZone="UTC" retryDelaysMs={[0]} />
    </StrictMode>,
  );
}

async function openNewTask(client: LedgerClient) {
  renderApp(client);
  await screen.findByRole("button", { name: "Start" });
  fireEvent.click(screen.getByRole("button", { name: /working on/i }));
  fireEvent.click(screen.getByRole("button", { name: /New task/ }));
  return screen.getByRole("dialog", { name: "New task" });
}

function typeName(name: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "Task name" }), {
    target: { value: name },
  });
}

function parentButton() {
  return screen.getByRole("button", { name: /^Parent/ });
}

async function createdNodes(client: LedgerClient, name: string) {
  const { nodes } = await client.listNodes({});
  return nodes.filter((node) => node.name === name);
}

describe("Task dialog model", () => {
  test("parentRows_exampleTree_drawsTheTreeAndHidesClosedTasks", () => {
    const rows = parentRows(dataOf(exampleNodes()));

    expect(
      rows.map(({ name, depth, guides, last }) => [name, depth, guides, last]),
    ).toEqual([
      ["Book", 0, [], false],
      ["Chapter 1", 1, [], true],
      ["Notes", 2, [false], true],
      ["Admin", 0, [], true],
    ]);
  });

  test("parentRows_editing_leavesOutTheTaskAndItsSubtree", () => {
    const rows = parentRows(dataOf(exampleNodes()), CHAPTER_1);

    expect(rows.map((row) => row.name)).toEqual(["Book", "Admin"]);
  });

  test("parentRows_newBranches_areChildrenOfTheirParent", () => {
    const rows = parentRows(dataOf(exampleNodes()), undefined, [
      { key: "drafts", name: "Drafts", parentId: BOOK },
      { key: "outline", name: "Outline", parentId: "drafts" },
    ]);

    expect(
      rows.map((row) => [row.name, row.kind, row.depth, row.last]),
    ).toEqual([
      ["Book", "node", 0, false],
      ["Chapter 1", "node", 1, false],
      ["Notes", "node", 2, true],
      ["Drafts", "new", 1, true],
      ["Outline", "new", 2, true],
      ["Admin", "node", 0, true],
    ]);
    expect(rows[2].guides).toEqual([true]);
    expect(rows[4].path).toEqual(["Book", "Drafts"]);
  });

  test("parentRows_addField_isTheLastChildOfItsRow", () => {
    const rows = parentRows(dataOf(exampleNodes()), undefined, [], {
      parentId: BOOK,
    });

    expect(rows.map((row) => [row.id, row.kind, row.depth])).toEqual([
      [BOOK, "node", 0],
      [CHAPTER_1, "node", 1],
      [expect.any(String), "node", 2],
      ["adding", "input", 1],
      [expect.any(String), "node", 0],
    ]);
  });

  test("filterParentRows_matchesTheNameOrThePath", () => {
    const rows = parentRows(dataOf(exampleNodes()));

    expect(filterParentRows(rows, "chapter").map((row) => row.name)).toEqual([
      "Chapter 1",
      "Notes",
    ]);
  });

  test("parentLabel_isThePathWithTheName", () => {
    const data = dataOf(exampleNodes());

    expect(parentLabel(data, { kind: "root" })).toBe("None");
    expect(parentLabel(data, { kind: "node", nodeId: CHAPTER_1 })).toBe(
      "Book / Chapter 1",
    );
    expect(
      parentLabel(data, { kind: "branch", key: "outline" }, [
        { key: "drafts", name: "Drafts", parentId: BOOK },
        { key: "outline", name: "Outline", parentId: "drafts" },
      ]),
    ).toBe("Book / Drafts / Outline");
  });
});

describe("New task", () => {
  test("newTask_fromThePicker_createsTheTaskAndStartShowsIt", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await openNewTask(recording.client);
    // Start's task is Notes, under Book / Chapter 1: the new task starts as its sibling.
    expect(parentButton().textContent).toContain("Book / Chapter 1");

    typeName("Migrations");
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(
      await screen.findByText("Migrations", { selector: ".task-strip-name" }),
    ).toBeDefined();
    expect(screen.queryByRole("dialog")).toBeNull();
    const [node] = await createdNodes(recording.client, "Migrations");
    expect(node.parentId).toBe(CHAPTER_1);
    expect(recording.createNodeRequestIds).toHaveLength(1);
  });

  test("newTask_inboxOnStart_startsWithNoParent", async () => {
    renderApp(recordingClient(exampleNodesWithNothingRunning()).client);
    await screen.findByRole("button", { name: "Start" });
    fireEvent.click(screen.getByRole("button", { name: /working on/i }));
    fireEvent.click(screen.getByText("Not sure yet"));
    fireEvent.click(
      screen.getByRole("button", { name: /What are you working on/ }),
    );

    fireEvent.click(screen.getByRole("button", { name: /New task/ }));

    expect(parentButton().textContent).toContain("None");
  });

  test("newTask_responseLost_retriesWithTheSameRequestId", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await openNewTask(recording.client);
    typeName("Migrations");

    recording.loseNextResponse();
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(
      await screen.findByText("Migrations", { selector: ".task-strip-name" }),
    ).toBeDefined();
    expect(recording.createNodeRequestIds).toHaveLength(2);
    expect(new Set(recording.createNodeRequestIds).size).toBe(1);
    expect(await createdNodes(recording.client, "Migrations")).toHaveLength(1);
  });

  test("newTask_noName_cannotCreate", async () => {
    await openNewTask(recordingClient(exampleNodesWithNothingRunning()).client);

    expect(
      screen.getByRole("button", { name: "Create" }).hasAttribute("disabled"),
    ).toBe(true);
    typeName("   ");
    expect(
      screen.getByRole("button", { name: "Create" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  test("newTask_estimate_sendsOnlyTheModesWithCycles", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await openNewTask(recording.client);

    typeName("Migrations");
    const more = screen.getByRole("button", {
      name: "Execution cycles: One cycle more",
    });
    fireEvent.click(more);
    fireEvent.click(more);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Execution minutes per cycle: 5 minutes less",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await screen.findByText("Migrations", { selector: ".task-strip-name" });
    const [node] = await createdNodes(recording.client, "Migrations");
    expect(
      node.estimates.map(({ mode, cycleMinutes, cycleCount }) => ({
        mode,
        cycleMinutes,
        cycleCount,
      })),
    ).toEqual([{ mode: FocusMode.EXECUTION, cycleMinutes: 45, cycleCount: 2 }]);
  });

  test("newTask_pickAParent_createsTheTaskUnderIt", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await openNewTask(recording.client);
    typeName("Migrations");

    fireEvent.click(parentButton());
    expect(
      screen.getByRole("textbox", { name: "Search for a parent" }),
    ).toHaveProperty("placeholder", "Where does Migrations belong?");
    fireEvent.click(screen.getByRole("button", { name: /^Chapter 1/ }));

    expect(parentButton().textContent).toContain("Book / Chapter 1");
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByText("Migrations", { selector: ".task-strip-name" });
    const [node] = await createdNodes(recording.client, "Migrations");
    expect(node.parentId).toBe(CHAPTER_1);
  });

  test("newTask_parentSearch_filtersTheTree", async () => {
    await openNewTask(recordingClient(exampleNodesWithNothingRunning()).client);
    fireEvent.click(parentButton());

    fireEvent.change(
      screen.getByRole("textbox", { name: "Search for a parent" }),
      { target: { value: "notes" } },
    );

    expect(
      screen
        .getAllByRole("button", { pressed: false })
        .map((button) => button.querySelector(".parent-name")?.textContent),
    ).toEqual(["Notes · Book / Chapter 1"]);
  });

  test("newTask_escapeInTheParentList_goesBackToTheForm", async () => {
    await openNewTask(recordingClient(exampleNodesWithNothingRunning()).client);
    typeName("Migrations");
    fireEvent.click(parentButton());

    fireEvent.keyDown(
      screen.getByRole("textbox", { name: "Search for a parent" }),
      { key: "Escape" },
    );

    expect(
      (screen.getByRole("textbox", { name: "Task name" }) as HTMLInputElement)
        .value,
    ).toBe("Migrations");
  });

  test("newTask_escapeAndCancel_closeWithoutAWrite", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await openNewTask(recording.client);
    typeName("Migrations");

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Task name" }), {
      key: "Escape",
    });
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /working on/i }));
    fireEvent.click(screen.getByRole("button", { name: /New task/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(recording.createNodeRequestIds).toEqual([]);
  });
});

describe("New branch in the parent tree (README Paused and the parent picker 2)", () => {
  function addBranch(under: string, name: string) {
    fireEvent.click(
      screen.getByRole("button", { name: `Add a task under ${under}` }),
    );
    const input = screen.getByRole("textbox", {
      name: `New task under ${under}`,
    });
    fireEvent.change(input, { target: { value: name } });
    fireEvent.keyDown(input, { key: "Enter" });
    return input as HTMLInputElement;
  }

  function pickRow(name: string) {
    const row = screen
      .getAllByRole("button", { pressed: false })
      .find(
        (button) => button.querySelector(".parent-name")?.textContent === name,
      );
    if (!row) throw new Error(`no row ${name}`);
    fireEvent.click(row);
  }

  function pressedRows() {
    return screen
      .getAllByRole("button", { pressed: true })
      .map((button) => button.querySelector(".parent-name")?.textContent);
  }

  async function addBranchUnderBook(client: LedgerClient) {
    await openNewTask(client);
    typeName("Migrations");
    fireEvent.click(parentButton());
    return addBranch("Book", "Drafts");
  }

  test("branch_enter_addsTheBranchAndClearsTheFieldButDoesNotSelect", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await openNewTask(recording.client);
    fireEvent.click(parentButton());
    const pickedBefore = pressedRows();

    const input = addBranch("Book", "Drafts");

    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);
    expect(
      screen.getByText("Drafts", { selector: ".parent-name" }),
    ).toBeDefined();
    expect(pressedRows()).toEqual(pickedBefore);
    expect(pickedBefore).not.toContain("Drafts");
    expect(recording.createNodeRequestIds).toEqual([]);
  });

  test("branch_twoBranchesThenSelectOne_createsBothParentsFirstOnCreate", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await addBranchUnderBook(recording.client);
    addBranch("Drafts", "Outline");
    fireEvent.keyDown(
      screen.getByRole("textbox", { name: "New task under Drafts" }),
      { key: "Escape" },
    );

    pickRow("Outline");

    expect(parentButton().textContent).toContain("Book / Drafts / Outline");
    expect(recording.createNodeRequestIds).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await screen.findByText("Migrations", { selector: ".task-strip-name" });
    const [drafts] = await createdNodes(recording.client, "Drafts");
    const [outline] = await createdNodes(recording.client, "Outline");
    const [task] = await createdNodes(recording.client, "Migrations");
    expect(drafts.parentId).toBe(BOOK);
    expect(outline.parentId).toBe(drafts.id);
    expect(task.parentId).toBe(outline.id);
    expect(new Set(recording.createNodeRequestIds).size).toBe(3);
  });

  test("branch_escape_leavesAddModeAndKeepsTheBranches", async () => {
    await addBranchUnderBook(
      recordingClient(exampleNodesWithNothingRunning()).client,
    );

    fireEvent.keyDown(
      screen.getByRole("textbox", { name: "New task under Book" }),
      { key: "Escape" },
    );

    expect(
      screen.queryByRole("textbox", { name: "New task under Book" }),
    ).toBeNull();
    const search = screen.getByRole("textbox", {
      name: "Search for a parent",
    }) as HTMLInputElement;
    expect(search.disabled).toBe(false);
    expect(
      screen.getByText("Drafts", { selector: ".parent-name" }),
    ).toBeDefined();

    fireEvent.keyDown(search, { key: "Escape" });
    fireEvent.click(parentButton());

    expect(
      screen.getByText("Drafts", { selector: ".parent-name" }),
    ).toBeDefined();
  });

  test("branch_arrowKeys_moveToARowThatAClickPicks", async () => {
    await openNewTask(recordingClient(exampleNodesWithNothingRunning()).client);
    fireEvent.click(parentButton());
    const search = screen.getByRole("textbox", { name: "Search for a parent" });

    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" });

    const focused = document.activeElement as HTMLElement;
    expect(focused.querySelector(".parent-name")?.textContent).toBe("Book");
    fireEvent.click(focused);
    expect(parentButton().textContent).toContain("Book");
  });

  function renderDialogOn(client: LedgerClient, nodes: NodePb[]) {
    const onDone = vi.fn();
    render(
      <TaskDialog
        data={dataOf(nodes)}
        onSave={(save) => writeTask(client, save, [0])}
        onDone={onDone}
        onClose={() => {}}
      />,
    );
    return onDone;
  }

  test("branch_emptyTree_addsATopLevelBranchAndCreatesTheTaskUnderIt", async () => {
    const recording = recordingClient([]);
    const onDone = renderDialogOn(recording.client, []);
    typeName("Migrations");
    fireEvent.click(parentButton());
    expect(
      screen
        .getAllByRole("button")
        .map((button) => button.querySelector(".parent-name")?.textContent)
        .filter(Boolean),
    ).toEqual(["None", "+ New top-level branch"]);

    fireEvent.click(
      screen.getByRole("button", { name: "+ New top-level branch" }),
    );
    const input = screen.getByRole("textbox", { name: "New top-level branch" });
    fireEvent.change(input, { target: { value: "Work" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(pressedRows()).toEqual(["None"]);
    pickRow("Work");
    expect(recording.createNodeRequestIds).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await vi.waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    const [work] = await createdNodes(recording.client, "Work");
    const [task] = await createdNodes(recording.client, "Migrations");
    expect(work.parentId).toBeUndefined();
    expect(task.parentId).toBe(work.id);
  });

  test("branch_searchWithNoMatch_addsTheTextAtTheTopLevel", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    const onDone = renderDialogOn(
      recording.client,
      exampleNodesWithNothingRunning(),
    );
    typeName("Migrations");
    fireEvent.click(parentButton());
    fireEvent.change(
      screen.getByRole("textbox", { name: "Search for a parent" }),
      { target: { value: "Garden" } },
    );

    fireEvent.click(
      screen.getByRole("button", { name: '+ Add "Garden" at the top level' }),
    );

    expect(
      (
        screen.getByRole("textbox", {
          name: "Search for a parent",
        }) as HTMLInputElement
      ).value,
    ).toBe("");
    expect(pressedRows()).not.toContain("Garden");
    pickRow("Garden");
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await vi.waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    const [garden] = await createdNodes(recording.client, "Garden");
    const [task] = await createdNodes(recording.client, "Migrations");
    expect(garden.parentId).toBeUndefined();
    expect(task.parentId).toBe(garden.id);
  });

  test("branch_cancel_createsNothing", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await addBranchUnderBook(recording.client);
    pickRow("Drafts");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(recording.createNodeRequestIds).toEqual([]);
    expect(await createdNodes(recording.client, "Drafts")).toEqual([]);
  });

  test("branch_taskCreateFails_keepsTheDialogAndARetryReusesBothIds", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    const inner = recording.client;
    const requestIds: (string | undefined)[] = [];
    const flaky: LedgerClient = {
      ...inner,
      createNode: (request, options) => {
        requestIds.push(request.requestId);
        if (requestIds.length === 2) {
          return Promise.reject(
            new ConnectError("the call failed", Code.Internal),
          );
        }
        return inner.createNode(request, options);
      },
    };
    const data = dataOf(exampleNodesWithNothingRunning());
    const onDone = vi.fn();
    render(
      <TaskDialog
        data={data}
        onSave={(save) => writeTask(flaky, save, [0])}
        onDone={onDone}
        onClose={() => {}}
      />,
    );
    typeName("Migrations");
    fireEvent.click(parentButton());
    addBranch("Book", "Drafts");
    pickRow("Drafts");

    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "not saved",
    );
    expect(onDone).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledOnce());

    const [branchId, taskId, retryBranchId, retryTaskId] = requestIds;
    expect(requestIds).toHaveLength(4);
    expect(retryBranchId).toBe(branchId);
    expect(retryTaskId).toBe(taskId);
    expect(await createdNodes(inner, "Drafts")).toHaveLength(1);
    const [task] = await createdNodes(inner, "Migrations");
    const [drafts] = await createdNodes(inner, "Drafts");
    expect(task.parentId).toBe(drafts.id);
  });
});

describe("Edit task", () => {
  function renderEdit(client: LedgerClient, nodeId: string) {
    const nodes = exampleNodesWithNothingRunning();
    const editing = nodes.find((node) => node.id === nodeId) as NodePb;
    const onDone = vi.fn();
    render(
      <TaskDialog
        data={dataOf(nodes)}
        editing={editing}
        onSave={(save) => writeTask(client, save, [0])}
        onDone={onDone}
        onClose={() => {}}
      />,
    );
    return onDone;
  }

  test("edit_showsTheTaskAndSavesNameParentAndEstimate", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    const onDone = renderEdit(recording.client, CHAPTER_1);

    expect(screen.getByRole("dialog", { name: "Edit task" })).toBeDefined();
    expect(
      (screen.getByRole("textbox", { name: "Task name" }) as HTMLInputElement)
        .value,
    ).toBe("Chapter 1");
    expect(parentButton().textContent).toContain("Book");
    expect(
      screen.getByRole("status", { name: "Execution cycles" }).textContent,
    ).toBe("20");

    typeName("Chapter one");
    fireEvent.click(parentButton());
    fireEvent.click(screen.getByRole("button", { name: /^None/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await vi.waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(recording.updateNodeMasks).toEqual([["name", "parent_id"]]);
    expect(recording.createNodeRequestIds).toEqual([]);
    const [saved] = await createdNodes(recording.client, "Chapter one");
    expect(saved.parentId).toBeUndefined();
    expect(saved.estimates.map((estimate) => estimate.cycleCount)).toEqual([
      20,
    ]);
  });

  test("edit_nameOnly_sendsOnlyTheName", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    const onDone = renderEdit(recording.client, CHAPTER_1);

    typeName("Chapter one");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await vi.waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(recording.updateNodeMasks).toEqual([["name"]]);
    const [saved] = await createdNodes(recording.client, "Chapter one");
    expect(saved.parentId).toBe(BOOK);
  });

  test("edit_estimateOnly_sendsOnlyTheEstimates", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    const onDone = renderEdit(recording.client, CHAPTER_1);

    fireEvent.click(
      screen.getByRole("button", { name: "Execution cycles: One cycle less" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await vi.waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(recording.updateNodeMasks).toEqual([["estimates"]]);
  });

  test("edit_noChange_writesNothing", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    const onDone = renderEdit(recording.client, CHAPTER_1);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await vi.waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(recording.updateNodeMasks).toEqual([]);
    expect(recording.createNodeRequestIds).toEqual([]);
  });

  test("edit_parentList_leavesOutTheTaskAndItsSubtree", () => {
    renderEdit(
      recordingClient(exampleNodesWithNothingRunning()).client,
      CHAPTER_1,
    );

    fireEvent.click(parentButton());

    expect(screen.queryByRole("button", { name: /^Chapter 1/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Notes/ })).toBeNull();
    expect(screen.getByRole("button", { name: /^Book/ })).toBeDefined();
  });
});
