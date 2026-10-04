import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "../App";
import type { LedgerClient } from "../api/ledgerClient";
import { exampleNow } from "../ledger/exampleData";
import {
  exampleNodesWithNothingRunning,
  recordingClient,
} from "../testing/appHarness";
import { fakeBell } from "../testing/fakeBell";
import { startCycleOn } from "../testing/navigation";

const BOOK_ID = "00000000-0000-4000-8000-00000000000a";

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(exampleNow);
});

afterEach(() => {
  vi.useRealTimers();
});

function renderAt(path: string, client?: LedgerClient) {
  window.history.replaceState(null, "", path);
  render(
    <StrictMode>
      <App
        client={
          client ?? recordingClient(exampleNodesWithNothingRunning()).client
        }
        timeZone="UTC"
        retryDelaysMs={[0]}
        bell={fakeBell().deps}
      />
    </StrictMode>,
  );
}

function header() {
  return within(screen.getByRole("navigation", { name: "Views" }));
}

async function goBack() {
  await act(async () => {
    window.history.back();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

async function goForward() {
  await act(async () => {
    window.history.forward();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

describe("Addresses", () => {
  test("directLoad_slash_opensStart", async () => {
    renderAt("/");

    expect(await screen.findByRole("button", { name: "Start" })).toBeDefined();
  });

  test("directLoad_tasks_opensTheTasksPage", async () => {
    renderAt("/tasks");

    expect(await screen.findByRole("list", { name: "Tasks" })).toBeDefined();
  });

  test("directLoad_taskId_opensThatTaskPage", async () => {
    renderAt(`/tasks/${BOOK_ID}`);

    expect(
      await screen.findByRole("button", { name: "Edit task, Book" }),
    ).toBeDefined();
  });

  test("directLoad_settings_opensSettings", async () => {
    renderAt("/settings");

    expect(
      await screen.findByRole("heading", { name: "Cycles" }),
    ).toBeDefined();
  });

  test("directLoad_report_opensTheReport", async () => {
    renderAt("/report");

    expect(
      await screen.findByRole("heading", { name: "This week" }),
    ).toBeDefined();
  });

  test("directLoad_unknownAddress_goesHome", async () => {
    renderAt("/no/such/page");

    expect(await screen.findByRole("button", { name: "Start" })).toBeDefined();
    expect(window.location.pathname).toBe("/");
  });

  test("directLoad_unknownTaskId_goesHome", async () => {
    renderAt("/tasks/00000000-0000-4000-8000-0000000000ff");

    expect(await screen.findByRole("button", { name: "Start" })).toBeDefined();
    expect(window.location.pathname).toBe("/");
  });

  test("headerLinks_changeTheAddress_andBackReturns", async () => {
    renderAt("/");
    await screen.findByRole("button", { name: "Start" });

    fireEvent.click(header().getByRole("button", { name: "Tasks" }));
    await screen.findByRole("list", { name: "Tasks" });
    expect(window.location.pathname).toBe("/tasks");
    fireEvent.click(screen.getByRole("listitem", { name: "Book" }));
    await screen.findByRole("button", { name: "Edit task, Book" });
    expect(window.location.pathname).toBe(`/tasks/${BOOK_ID}`);

    await goBack();
    expect(await screen.findByRole("list", { name: "Tasks" })).toBeDefined();
    await goBack();
    expect(await screen.findByRole("button", { name: "Start" })).toBeDefined();
    await goForward();
    expect(await screen.findByRole("list", { name: "Tasks" })).toBeDefined();
  });

  test("backAndForward_duringACycle_neverTouchTheCycle", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    renderAt("/", recording.client);
    await startCycleOn("Book", "Shallow");

    fireEvent.click(header().getByRole("button", { name: "Settings" }));
    await screen.findByRole("heading", { name: "Cycles" });
    await goBack();
    expect(
      await screen.findByRole("timer", { name: "Time left" }),
    ).toBeDefined();
    await goForward();
    await screen.findByRole("heading", { name: "Cycles" });
    await goBack();

    expect(
      await screen.findByRole("timer", { name: "Time left" }),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Pause" })).toBeDefined();
    expect(recording.updateCycleMinutes).toEqual([]);
  });
});
