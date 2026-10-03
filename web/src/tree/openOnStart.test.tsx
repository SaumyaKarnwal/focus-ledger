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

describe("Tree and Today together", () => {
  async function openTree(client: LedgerClient) {
    renderApp(client);
    const nav = await screen.findByRole("navigation", { name: "Views" });
    fireEvent.click(within(nav).getByRole("button", { name: "Tasks" }));
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

    expect(
      await screen.findByText("Admin", { selector: ".task-strip-name" }),
    ).toBeDefined();
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
