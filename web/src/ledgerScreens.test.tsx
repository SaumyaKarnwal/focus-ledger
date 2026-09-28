import { Code } from "@connectrpc/connect";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "./App";
import type { LedgerClient } from "./api/ledgerClient";
import { FocusMode, type CyclePb } from "./gen/focusledger/v1/model_pb";
import { exampleNow } from "./ledger/exampleData";
import {
  exampleNodesWithNothingRunning,
  recordingClient,
} from "./testing/appHarness";

const BOOK = "00000000-0000-4000-8000-00000000000a";
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

function renderApp(client: LedgerClient) {
  return render(
    <StrictMode>
      <App client={client} timeZone="UTC" retryDelaysMs={[0]} />
    </StrictMode>,
  );
}

async function openView(client: LedgerClient, view: "Tree" | "Inbox") {
  renderApp(client);
  const nav = await screen.findByRole("navigation", { name: "Views" });
  fireEvent.click(within(nav).getByRole("button", { name: view }));
}

async function openTree(client: LedgerClient) {
  await openView(client, "Tree");
  return screen.findByRole("listitem", { name: "Book" });
}

function row(name: string) {
  return screen.getByRole("listitem", { name });
}

/** The row's own figures, without its children's rows. */
function rowText(name: string) {
  return Array.from(row(name).children)
    .filter((element) => element.tagName === "SPAN")
    .map((element) => element.textContent)
    .join("");
}

function clickInRow(name: string, button: string) {
  fireEvent.click(
    within(row(name)).getAllByRole("button", { name: button })[0],
  );
}

function isUnder(parent: string, child: string) {
  return within(row(parent)).queryByRole("listitem", { name: child }) !== null;
}

async function allCycles(client: LedgerClient): Promise<CyclePb[]> {
  const { nodes } = await client.listNodes({ includeClosed: true });
  return nodes.flatMap((node) => node.cycles);
}

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
}

describe("Tree", () => {
  test("tree_open_showsRolledUpFiguresWithoutClosedNodes", async () => {
    const { client } = recordingClient(exampleNodesWithNothingRunning());

    await openTree(client);

    expect(rowText("Book")).toBe("Book · 6 / 25 · 7h 15m");
    expect(isUnder("Book", "Chapter 1")).toBe(true);
    expect(isUnder("Chapter 1", "Notes")).toBe(true);
    expect(screen.queryByRole("listitem", { name: "Chapter 2" })).toBeNull();
  });

  test("tree_showClosed_addsTheClosedNodeAndItsTime", async () => {
    const { client } = recordingClient(exampleNodesWithNothingRunning());
    await openTree(client);

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Show closed nodes" }),
    );

    await screen.findByRole("listitem", { name: "Chapter 2" });
    expect(rowText("Chapter 2")).toBe("Chapter 2 (closed) · 2 / 15 · 55m");
    expect(rowText("Book")).toBe("Book · 8 / 40 · 8h 10m");
  });

  test("tree_addTopLevelNodes_createsEachWithItsOwnRequestId", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await openTree(recording.client);

    fireEvent.click(
      screen.getByRole("button", { name: "Add a top-level node" }),
    );
    const input = screen.getByRole("textbox", { name: "New top-level node" });
    fireEvent.change(input, { target: { value: "Garden" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByRole("listitem", { name: "Garden" });
    fireEvent.change(input, { target: { value: "Taxes" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByRole("listitem", { name: "Taxes" });

    expect((input as HTMLInputElement).value).toBe("");
    expect(new Set(recording.createNodeRequestIds).size).toBe(2);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(
      screen.queryByRole("textbox", { name: "New top-level node" }),
    ).toBeNull();
  });

  test("tree_addChild_createsTheNodeUnderTheRow", async () => {
    const { client } = recordingClient(exampleNodesWithNothingRunning());
    await openTree(client);

    clickInRow("Admin", "Add child");
    const input = screen.getByRole("textbox", { name: "New node under Admin" });
    fireEvent.change(input, { target: { value: "Receipts" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await screen.findByRole("listitem", { name: "Receipts" });
    expect(isUnder("Admin", "Receipts")).toBe(true);
  });

  test("tree_createResponseLost_retriesWithTheSameRequestId", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await openTree(recording.client);
    fireEvent.click(
      screen.getByRole("button", { name: "Add a top-level node" }),
    );
    const input = screen.getByRole("textbox", { name: "New top-level node" });
    fireEvent.change(input, { target: { value: "Garden" } });

    recording.loseNextResponse();
    fireEvent.keyDown(input, { key: "Enter" });

    await screen.findByRole("listitem", { name: "Garden" });
    expect(recording.createNodeRequestIds).toHaveLength(2);
    expect(new Set(recording.createNodeRequestIds).size).toBe(1);
    expect(screen.getAllByRole("listitem", { name: "Garden" })).toHaveLength(1);
  });

  test("tree_secondPressAfterFailedCreate_sendsTheSameRequestId", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await openTree(recording.client);
    fireEvent.click(
      screen.getByRole("button", { name: "Add a top-level node" }),
    );
    const input = screen.getByRole("textbox", { name: "New top-level node" });
    fireEvent.change(input, { target: { value: "Garden" } });
    recording.failNext("CreateNode", Code.Internal);

    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await screen.findByRole("listitem", { name: "Garden" });
    expect(recording.createNodeRequestIds).toHaveLength(2);
    expect(new Set(recording.createNodeRequestIds).size).toBe(1);
  });

  test("tree_rename_sendsOnlyTheNameMask", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await openTree(recording.client);

    clickInRow("Admin", "Rename");
    const input = screen.getByRole("textbox", { name: "New name for Admin" });
    fireEvent.change(input, { target: { value: "Paperwork" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await screen.findByRole("listitem", { name: "Paperwork" });
    expect(recording.updateNodeMasks).toEqual([["name"]]);
  });

  test("tree_moveToAnotherParent_statesWhatMovesAndMovesIt", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await openTree(recording.client);

    clickInRow("Chapter 1", "Move to…");
    expect(
      screen.getByText("3 cycles · 2h 40m will move with it"),
    ).toBeDefined();
    fireEvent.change(
      screen.getByRole("combobox", { name: /Move Chapter 1 under/ }),
      {
        target: { value: ADMIN },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    await settle();

    await vi.waitFor(() => expect(isUnder("Admin", "Chapter 1")).toBe(true));
    expect(isUnder("Book", "Chapter 1")).toBe(false);
    expect(rowText("Admin")).toBe("Admin · 3 / 20 · 2h 40m");
    expect(recording.updateNodeMasks).toEqual([["parent_id"]]);
  });

  test("tree_moveToTopLevel_makesTheNodeARoot", async () => {
    const { client } = recordingClient(exampleNodesWithNothingRunning());
    await openTree(client);

    clickInRow("Notes", "Move to…");
    fireEvent.change(
      screen.getByRole("combobox", { name: /Move Notes under/ }),
      {
        target: { value: "" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Move" }));

    await vi.waitFor(() => expect(isUnder("Book", "Notes")).toBe(false));
    expect(screen.getByRole("listitem", { name: "Notes" })).toBeDefined();
  });

  test("tree_moveUnderOwnDescendant_showsTheErrorAndKeepsTheTree", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await openTree(recording.client);
    const notesId = "00000000-0000-4000-8000-00000000000d";

    clickInRow("Book", "Move to…");
    fireEvent.change(
      screen.getByRole("combobox", { name: /Move Book under/ }),
      {
        target: { value: notesId },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Move" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "cannot move under itself or its descendant",
    );
    expect(isUnder("Book", "Notes")).toBe(true);
    expect(isUnder("Notes", "Book")).toBe(false);
    const { nodes } = await recording.client.listNodes({});
    expect(nodes.find((node) => node.id === BOOK)?.parentId).toBeUndefined();
  });

  test("tree_closeAndReopen_sendOnlyTheClosedMask", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await openTree(recording.client);

    clickInRow("Admin", "Close");
    await vi.waitFor(() =>
      expect(screen.queryByRole("listitem", { name: "Admin" })).toBeNull(),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Show closed nodes" }),
    );
    await screen.findByRole("listitem", { name: "Admin" });
    expect(rowText("Admin")).toContain("(closed)");
    clickInRow("Admin", "Reopen");

    await vi.waitFor(() => expect(rowText("Admin")).not.toContain("(closed)"));
    expect(recording.updateNodeMasks).toEqual([["closed"], ["closed"]]);
  });
});

describe("Estimates", () => {
  test("estimate_saveThreeExecutionCycles_sendsTheEstimatesMask", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await openTree(recording.client);

    clickInRow("Admin", "Estimate");
    const editor = screen.getByRole("group", { name: "Estimate for Admin" });
    ["More", "More", "More"].forEach(() =>
      fireEvent.click(
        within(editor).getByRole("button", { name: "More Execution cycles" }),
      ),
    );
    expect(within(editor).getByLabelText("Estimate summary").textContent).toBe(
      "3 cycles · 2h 30m",
    );
    fireEvent.click(
      within(editor).getByRole("button", { name: "Save estimate" }),
    );

    await vi.waitFor(() => expect(rowText("Admin")).toBe("Admin · 0 / 3 · 0m"));
    expect(recording.updateNodeMasks).toEqual([["estimates"]]);
    const { nodes } = await recording.client.listNodes({});
    expect(nodes.find((node) => node.id === ADMIN)?.estimates).toMatchObject([
      { mode: FocusMode.DEEP_FOCUS, cycleMinutes: 90, cycleCount: 0 },
      { mode: FocusMode.EXECUTION, cycleMinutes: 50, cycleCount: 3 },
      { mode: FocusMode.SHALLOW, cycleMinutes: 25, cycleCount: 0 },
    ]);
  });

  test("estimate_belowTheLoggedCount_isAllowedAndShowsTheOverage", async () => {
    const { client } = recordingClient(exampleNodesWithNothingRunning());
    await openTree(client);

    clickInRow("Book", "Estimate");
    const editor = screen.getByRole("group", { name: "Estimate for Book" });
    [1, 2, 3].forEach(() =>
      fireEvent.click(
        within(editor).getByRole("button", { name: "Fewer Deep Focus cycles" }),
      ),
    );
    fireEvent.click(
      within(editor).getByRole("button", { name: "Save estimate" }),
    );

    await vi.waitFor(() =>
      expect(rowText("Book")).toBe("Book · 6 / 22 · 7h 15m"),
    );
  });

  test("estimate_cancel_writesNothingAndKeepsTheEstimate", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await openTree(recording.client);

    clickInRow("Book", "Estimate");
    const editor = screen.getByRole("group", { name: "Estimate for Book" });
    fireEvent.click(
      within(editor).getByRole("button", { name: "More Deep Focus cycles" }),
    );
    fireEvent.click(within(editor).getByRole("button", { name: "Cancel" }));
    clickInRow("Book", "Estimate");

    expect(recording.updateNodeMasks).toEqual([]);
    expect(
      screen.getByRole("status", { name: "Deep Focus count" }).textContent,
    ).toBe("5");
  });
});

describe("Entries", () => {
  function fillEntry(dialog: HTMLElement, fields: Record<string, string>) {
    Object.entries(fields).forEach(([label, value]) =>
      fireEvent.change(within(dialog).getByLabelText(label), {
        target: { value },
      }),
    );
  }

  test("entry_fromTreeRow_writesAHandEntryWithPlannedMinutesZero", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await openTree(recording.client);
    const before = (await allCycles(recording.client)).length;

    clickInRow("Admin", "Add an entry");
    const dialog = screen.getByRole("dialog", { name: "Admin" });
    fireEvent.click(within(dialog).getByRole("radio", { name: "Execution" }));
    fillEntry(dialog, {
      Date: "2026-10-30",
      "Start time": "16:00",
      "Length in minutes": "40",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save entry" }));

    await vi.waitFor(() =>
      expect(rowText("Admin")).toBe("Admin · 1 / 0 · 40m"),
    );
    const cycles = await allCycles(recording.client);
    expect(cycles).toHaveLength(before + 1);
    const entry = cycles.find((cycle) => cycle.nodeId === ADMIN);
    expect(entry).toMatchObject({
      mode: FocusMode.EXECUTION,
      minutes: 40,
      plannedMinutes: 40,
    });
    expect(timestampDate(entry!.startedAt!).toISOString()).toBe(
      "2026-10-30T16:00:00.000Z",
    );
  });

  test("entry_dialog_isTitledWithTheNodeName", async () => {
    const { client } = recordingClient(exampleNodesWithNothingRunning());
    await openTree(client);

    clickInRow("Admin", "Add an entry");

    const dialog = screen.getByRole("dialog", { name: "Admin" });
    expect(
      within(dialog).queryByRole("heading", { name: "Add an entry" }),
    ).toBeNull();
    fireEvent.change(within(dialog).getByLabelText("Node"), {
      target: { value: BOOK },
    });
    expect(screen.getByRole("dialog", { name: "Book" })).toBeDefined();
  });

  test.each(["0", "1441"])(
    "entry_length%s_isRejectedAndWritesNothing",
    async (length) => {
      const recording = recordingClient(exampleNodesWithNothingRunning());
      await openTree(recording.client);
      const before = (await allCycles(recording.client)).length;

      clickInRow("Admin", "Add an entry");
      const dialog = screen.getByRole("dialog", { name: "Admin" });
      fillEntry(dialog, { "Length in minutes": length });
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Save entry" }),
      );

      expect((await within(dialog).findByRole("alert")).textContent).toContain(
        "minutes must be 1 to 1440",
      );
      expect(await allCycles(recording.client)).toHaveLength(before);
    },
  );

  test("entry_responseLost_retriesWithTheSameRequestId", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await openTree(recording.client);
    const before = (await allCycles(recording.client)).length;

    clickInRow("Admin", "Add an entry");
    const dialog = screen.getByRole("dialog", { name: "Admin" });
    recording.loseNextResponse();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save entry" }));

    await vi.waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Admin" })).toBeNull(),
    );
    expect(recording.createCycleRequestIds).toHaveLength(2);
    expect(new Set(recording.createCycleRequestIds).size).toBe(1);
    expect(await allCycles(recording.client)).toHaveLength(before + 1);
  });

  test("entry_cancel_writesNothing", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await openTree(recording.client);

    clickInRow("Admin", "Add an entry");
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Admin" })).getByRole(
        "button",
        {
          name: "Cancel",
        },
      ),
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(recording.createCycleRequestIds).toEqual([]);
  });

  test("entry_fromToday_appearsInLoggedToday", async () => {
    const { client } = recordingClient(exampleNodesWithNothingRunning());
    renderApp(client);
    const selected = await screen.findByRole("region", { name: "Notes" });
    const loggedBefore = within(selected).getAllByRole("listitem").length;

    fireEvent.click(
      within(selected).getByRole("button", { name: "+ Add an entry" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Notes" });
    fillEntry(dialog, { "Start time": "12:00", "Length in minutes": "20" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save entry" }));

    await vi.waitFor(() =>
      expect(
        within(screen.getByRole("region", { name: "Notes" })).getAllByRole(
          "listitem",
        ),
      ).toHaveLength(loggedBefore + 1),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("entry_onAnEarlierDayOfTheWeek_changesTheWeekButNotToday", async () => {
    const { client } = recordingClient(exampleNodesWithNothingRunning());
    renderApp(client);
    const selected = await screen.findByRole("region", { name: "Notes" });
    const loggedBefore = within(selected).getAllByRole("listitem").length;

    fireEvent.click(
      within(selected).getByRole("button", { name: "+ Add an entry" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Notes" });
    fillEntry(dialog, {
      Date: "2026-10-27",
      "Start time": "10:00",
      "Length in minutes": "50",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save entry" }));

    await vi.waitFor(() =>
      expect(
        within(screen.getByRole("group", { name: "This week" })).getByRole(
          "heading",
        ).textContent,
      ).toBe("This week: 6h 40m"),
    );
    expect(
      within(screen.getByRole("group", { name: "Today" })).getByRole("heading")
        .textContent,
    ).toBe("Today: 2h 30m");
    expect(
      within(screen.getByRole("region", { name: "Notes" })).getAllByRole(
        "listitem",
      ),
    ).toHaveLength(loggedBefore);
  });
});

describe("Inbox", () => {
  test("inbox_open_listsTheUnfiledCycles", async () => {
    const { client } = recordingClient(exampleNodesWithNothingRunning());

    await openView(client, "Inbox");

    expect(await screen.findAllByTestId("inbox-row")).toHaveLength(2);
  });

  test("inbox_fileACycle_setsItsNodeWithTheNodeIdMask", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await openView(recording.client, "Inbox");
    const [first] = await screen.findAllByTestId("inbox-row");

    fireEvent.change(within(first).getByRole("combobox", { name: "File to" }), {
      target: { value: ADMIN },
    });
    fireEvent.click(within(first).getByRole("button", { name: "File" }));

    await vi.waitFor(() =>
      expect(screen.getAllByTestId("inbox-row")).toHaveLength(1),
    );
    expect(recording.updateCycleMasks).toEqual([["node_id"]]);
    const filed = (await allCycles(recording.client)).find(
      (cycle) => cycle.id === INBOX_SHALLOW,
    );
    expect(filed?.nodeId).toBe(ADMIN);
  });

  test("inbox_secondFiling_showsTheErrorAndKeepsTheFirstNode", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await openView(recording.client, "Inbox");
    const [first] = await screen.findAllByTestId("inbox-row");
    await recording.client.updateCycle({
      cycleId: INBOX_SHALLOW,
      nodeId: ADMIN,
      updateMask: { paths: ["node_id"] },
    });

    fireEvent.change(within(first).getByRole("combobox", { name: "File to" }), {
      target: { value: BOOK },
    });
    fireEvent.click(within(first).getByRole("button", { name: "File" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "already filed",
    );
    await vi.waitFor(() =>
      expect(screen.getAllByTestId("inbox-row")).toHaveLength(1),
    );
    const filed = (await allCycles(recording.client)).find(
      (cycle) => cycle.id === INBOX_SHALLOW,
    );
    expect(filed?.nodeId).toBe(ADMIN);
  });
});
