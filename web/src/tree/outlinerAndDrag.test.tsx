import { fireEvent, render, screen, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "../App";
import type { LedgerClient } from "../api/ledgerClient";
import { exampleNow } from "../ledger/exampleData";
import {
  exampleNodesWithNothingRunning,
  recordingClient,
} from "../testing/appHarness";

const NOTES = "00000000-0000-4000-8000-00000000000d";

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(exampleNow);
});

afterEach(() => {
  vi.useRealTimers();
});

async function openTree(client: LedgerClient) {
  render(
    <StrictMode>
      <App client={client} timeZone="UTC" retryDelaysMs={[0]} />
    </StrictMode>,
  );
  const nav = await screen.findByRole("navigation", { name: "Views" });
  fireEvent.click(within(nav).getByRole("button", { name: "Tasks" }));
  await screen.findByRole("listitem", { name: "Book" });
}

function row(name: string) {
  return screen.getByRole("listitem", { name });
}

function rowBox(name: string) {
  return row(name).querySelector(".tree-row") as HTMLElement;
}

function isUnder(parent: string, child: string) {
  return within(row(parent)).queryByRole("listitem", { name: child }) !== null;
}

async function parentOf(client: LedgerClient, name: string) {
  const { nodes } = await client.listNodes({});
  const node = nodes.find((listed) => listed.name === name);
  return nodes.find((listed) => listed.id === node?.parentId)?.name;
}

describe("Outliner", () => {
  function draftInput() {
    return screen.getByRole("textbox", { name: /^New (top-level )?node/ });
  }

  async function typeAndPress(
    name: string,
    key: string,
    modifiers: { shiftKey?: boolean; metaKey?: boolean } = {},
  ) {
    fireEvent.change(draftInput(), { target: { value: name } });
    fireEvent.keyDown(draftInput(), { key, ...modifiers });
  }

  test("outliner_tabAndShiftTab_typeAWholeProjectWithTheKeyboard", async () => {
    const { client } = recordingClient(exampleNodesWithNothingRunning());
    await openTree(client);
    fireEvent.click(
      screen.getByRole("button", { name: "Add a top-level node" }),
    );

    await typeAndPress("Garden", "Enter");
    await screen.findByRole("listitem", { name: "Garden" });
    fireEvent.keyDown(draftInput(), { key: "Tab" });
    expect(screen.getByText("new child of Garden")).toBeDefined();
    await typeAndPress("Beds", "Enter");
    await screen.findByRole("listitem", { name: "Beds" });
    fireEvent.keyDown(draftInput(), { key: "Tab" });
    await typeAndPress("Soil", "Enter");
    await screen.findByRole("listitem", { name: "Soil" });
    fireEvent.keyDown(draftInput(), { key: "Tab", shiftKey: true });
    expect(screen.getByText("new child of Garden")).toBeDefined();
    await typeAndPress("Tools", "Enter");
    await screen.findByRole("listitem", { name: "Tools" });

    expect(await parentOf(client, "Beds")).toBe("Garden");
    expect(await parentOf(client, "Soil")).toBe("Beds");
    expect(await parentOf(client, "Tools")).toBe("Garden");
    expect(isUnder("Beds", "Soil")).toBe(true);
    expect(isUnder("Garden", "Tools")).toBe(true);
  });

  test("outliner_tabWithNoRowAbove_keepsTheParent", async () => {
    const { client } = recordingClient(exampleNodesWithNothingRunning());
    await openTree(client);
    fireEvent.click(
      within(row("Admin")).getByRole("button", {
        name: "Add a child of Admin",
      }),
    );

    fireEvent.keyDown(draftInput(), { key: "Tab" });

    expect(screen.getByText("new child of Admin")).toBeDefined();
  });

  test("outliner_shiftTabAtTheTop_staysAtTheTop", async () => {
    const { client } = recordingClient(exampleNodesWithNothingRunning());
    await openTree(client);
    fireEvent.click(
      screen.getByRole("button", { name: "Add a top-level node" }),
    );

    fireEvent.keyDown(draftInput(), { key: "Tab", shiftKey: true });

    expect(screen.getByText("new top-level node")).toBeDefined();
  });

  test("outliner_commandEnter_savesAndOpensTheNodeOnToday", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await openTree(recording.client);
    fireEvent.click(
      screen.getByRole("button", { name: "Add a top-level node" }),
    );

    await typeAndPress("Garden", "Enter", { metaKey: true });

    expect(
      await screen.findByText("Garden", { selector: ".task-strip-name" }),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Start" })).toBeDefined();
    expect(recording.createCycleRequestIds).toEqual([]);
  });

  test("outliner_escape_closesAndWritesNothing", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await openTree(recording.client);
    fireEvent.click(
      screen.getByRole("button", { name: "Add a top-level node" }),
    );

    await typeAndPress("Garden", "Escape");

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(recording.createNodeRequestIds).toEqual([]);
  });
});

describe("Drag", () => {
  function drag(from: string, onto: HTMLElement) {
    fireEvent.dragStart(rowBox(from));
    const allowed = !fireEvent.dragOver(onto);
    fireEvent.drop(onto);
    return allowed;
  }

  test("drag_nodeWithoutCycles_movesAtOnce", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await openTree(recording.client);

    expect(drag("Admin", rowBox("Book"))).toBe(true);

    await vi.waitFor(() => expect(isUnder("Book", "Admin")).toBe(true));
    expect(recording.updateNodeMasks).toEqual([["parent_id"]]);
    expect(await parentOf(recording.client, "Admin")).toBe("Book");
  });

  test("drag_nodeWithCycles_statesWhatMovesBeforeMoving", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await openTree(recording.client);

    drag("Chapter 1", rowBox("Admin"));

    const confirm = screen.getByRole("region", { name: "Confirm the move" });
    expect(confirm.textContent).toContain(
      "3 cycles · 2h 40m will move with it",
    );
    expect(recording.updateNodeMasks).toEqual([]);
    fireEvent.click(within(confirm).getByRole("button", { name: "Move" }));

    await vi.waitFor(() => expect(isUnder("Admin", "Chapter 1")).toBe(true));
    expect(recording.updateNodeMasks).toEqual([["parent_id"]]);
  });

  test("drag_cancelTheConfirm_writesNothing", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await openTree(recording.client);

    drag("Chapter 1", rowBox("Admin"));
    fireEvent.click(
      within(
        screen.getByRole("region", { name: "Confirm the move" }),
      ).getByRole("button", { name: "Cancel" }),
    );

    expect(
      screen.queryByRole("region", { name: "Confirm the move" }),
    ).toBeNull();
    expect(recording.updateNodeMasks).toEqual([]);
    expect(isUnder("Book", "Chapter 1")).toBe(true);
  });

  test("drag_ontoOwnDescendant_isNotADropTarget", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await openTree(recording.client);

    expect(drag("Book", rowBox("Notes"))).toBe(false);

    expect(
      screen.queryByRole("region", { name: "Confirm the move" }),
    ).toBeNull();
    expect(recording.updateNodeMasks).toEqual([]);
  });

  test("drag_ontoTheTopLevelZone_makesTheNodeARoot", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await openTree(recording.client);

    fireEvent.dragStart(rowBox("Notes"));
    const zone = screen.getByTestId("top-level-drop");
    expect(zone.textContent).toContain("Notes");
    fireEvent.dragOver(zone);
    fireEvent.drop(zone);
    fireEvent.click(
      within(
        screen.getByRole("region", { name: "Confirm the move" }),
      ).getByRole("button", { name: "Move" }),
    );

    await vi.waitFor(() => expect(isUnder("Book", "Notes")).toBe(false));
    const { nodes } = await recording.client.listNodes({});
    expect(nodes.find((node) => node.id === NOTES)?.parentId).toBeUndefined();
  });

  test("drag_ontoTheCurrentParent_isNotADropTarget", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await openTree(recording.client);

    expect(drag("Chapter 1", rowBox("Book"))).toBe(false);

    expect(recording.updateNodeMasks).toEqual([]);
  });
});
