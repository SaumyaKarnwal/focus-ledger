import { fireEvent, render, screen, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "../App";
import type { LedgerClient } from "../api/ledgerClient";
import { FocusMode } from "../gen/focusledger/v1/model_pb";
import { exampleNow } from "../ledger/exampleData";
import {
  exampleNodesWithNothingRunning,
  recordingClient,
} from "../testing/appHarness";

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

async function selectOnToday(name: string) {
  const rail = await screen.findByRole("list", { name: "Open nodes" });
  const button = within(rail)
    .getAllByRole("button")
    .find(
      (candidate) =>
        candidate.querySelector('[data-part="name"]')?.textContent === name,
    );
  fireEvent.click(button!);
}

async function bookEstimates(client: LedgerClient) {
  const { nodes } = await client.listNodes({});
  return nodes.find((node) => node.id === BOOK)?.estimates;
}

describe("Estimate on Today", () => {
  test("todayEstimate_editing_holdsStart", async () => {
    renderApp(recordingClient(exampleNodesWithNothingRunning()).client);
    await selectOnToday("Book");

    fireEvent.click(screen.getByRole("button", { name: "Edit estimate" }));

    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Five minutes more" }),
    ).toBeNull();
    expect(
      screen.getByText(/Starting is held while you change the plan/),
    ).toBeDefined();
    expect(screen.queryByTestId("meta-line")).toBeNull();
  });

  test("todayEstimate_save_sendsTheEstimatesMaskAndGivesStartBack", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    renderApp(recording.client);
    await selectOnToday("Book");
    fireEvent.click(screen.getByRole("button", { name: "Edit estimate" }));

    fireEvent.click(
      screen.getByRole("button", { name: "More Execution cycles" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "More Execution cycles" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("button", { name: "Start" })).toBeDefined();
    expect(recording.updateNodeMasks).toEqual([["estimates"]]);
    expect(await bookEstimates(recording.client)).toMatchObject([
      { mode: FocusMode.DEEP_FOCUS, cycleMinutes: 90, cycleCount: 5 },
      { mode: FocusMode.EXECUTION, cycleMinutes: 50, cycleCount: 2 },
      { mode: FocusMode.SHALLOW, cycleMinutes: 25, cycleCount: 0 },
    ]);
    expect(
      screen.getByRole("heading", { name: /Estimate ·/ }).textContent,
    ).toBe("Estimate · 3 of 7 cycles done");
  });

  test("todayEstimate_cancel_writesNothingAndGivesStartBack", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    renderApp(recording.client);
    await selectOnToday("Book");
    fireEvent.click(screen.getByRole("button", { name: "Edit estimate" }));
    fireEvent.click(
      screen.getByRole("button", { name: "More Deep Focus cycles" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByRole("button", { name: "Start" })).toBeDefined();
    expect(recording.updateNodeMasks).toEqual([]);
    expect(
      screen.getByRole("heading", { name: /Estimate ·/ }).textContent,
    ).toBe("Estimate · 3 of 5 cycles done");
  });

  test("todayModeRows_atRest_showPipsAndFigures", async () => {
    renderApp(recordingClient(exampleNodesWithNothingRunning()).client);
    await selectOnToday("Book");

    const deep = screen
      .getByRole("radio", { name: "Deep Focus" })
      .closest("label")!;
    const shallow = screen
      .getByRole("radio", { name: "Shallow" })
      .closest("label")!;

    expect(deep.querySelectorAll(".pip")).toHaveLength(3);
    expect(deep.textContent).toContain("3 of 5 · 90 min");
    expect(shallow.textContent).toContain("not estimated, none logged");
  });
});

describe("Tree and Today together", () => {
  async function openTree(client: LedgerClient) {
    renderApp(client);
    const nav = await screen.findByRole("navigation", { name: "Views" });
    fireEvent.click(within(nav).getByRole("button", { name: "Tree" }));
    return screen.findByRole("listitem", { name: "Book" });
  }

  test("tree_openOnToday_selectsTheNodeOnToday", async () => {
    const { client } = recordingClient(exampleNodesWithNothingRunning());
    await openTree(client);

    fireEvent.click(
      screen
        .getByRole("listitem", { name: "Admin" })
        .querySelector('[data-part="name"]')!,
    );
    fireEvent.click(
      within(
        screen.getByRole("complementary", { name: "Node detail" }),
      ).getByRole("button", { name: "Open on Today" }),
    );

    expect(await screen.findByRole("region", { name: "Admin" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Start" })).toBeDefined();
  });

  test("tree_newNodeWithAnEstimate_sendsTheEstimateOnCreate", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await openTree(recording.client);

    fireEvent.click(
      screen.getByRole("button", { name: "Add a top-level node" }),
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "New top-level node" }),
      {
        target: { value: "Garden" },
      },
    );
    const panel = within(
      screen.getByRole("complementary", { name: "Node detail" }),
    );
    expect(panel.getByRole("heading", { name: "Garden" })).toBeDefined();
    fireEvent.click(panel.getByRole("button", { name: "More Shallow cycles" }));
    fireEvent.click(panel.getByRole("button", { name: "Add" }));

    await screen.findByRole("listitem", { name: "Garden" });
    const { nodes } = await recording.client.listNodes({});
    expect(
      nodes.find((node) => node.name === "Garden")?.estimates,
    ).toMatchObject([
      { mode: FocusMode.SHALLOW, cycleMinutes: 25, cycleCount: 1 },
    ]);
  });
});
