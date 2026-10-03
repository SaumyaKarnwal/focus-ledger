import { Code } from "@connectrpc/connect";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "../App";
import type { LedgerClient } from "../api/ledgerClient";
import { FocusMode } from "../gen/focusledger/v1/model_pb";
import { exampleNow } from "../ledger/exampleData";
import { recordingClient } from "../testing/appHarness";

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

async function openFirstRun() {
  const recording = recordingClient([]);
  renderApp(recording.client);
  await screen.findByRole("button", { name: /Start the first cycle/ });
  return recording;
}

async function allNodes(client: LedgerClient) {
  return (await client.listNodes({ includeClosed: true })).nodes;
}

describe("First run", () => {
  test("firstRun_noData_showsExecutionFiftyTimesOne", async () => {
    await openFirstRun();

    expect(
      (screen.getByRole("radio", { name: "Execution" }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(
      screen.getByRole("status", { name: "Execution count" }).textContent,
    ).toBe("1");
    expect(
      screen.getByRole("status", { name: "Deep Focus count" }).textContent,
    ).toBe("0");
    expect(screen.getByLabelText("Estimate summary").textContent).toBe(
      "1 cycle · 50m",
    );
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  test("firstRun_startUntouched_startsFiftyMinutesOfExecutionInTheInbox", async () => {
    const recording = await openFirstRun();

    fireEvent.click(
      screen.getByRole("button", { name: /Start the first cycle/ }),
    );

    expect(
      await screen.findByRole("timer", { name: "Time left" }),
    ).toBeDefined();
    expect(recording.createNodeRequestIds).toEqual([]);
    const running = (await allNodes(recording.client)).flatMap(
      (node) => node.cycles,
    );
    expect(running).toMatchObject([
      { mode: FocusMode.EXECUTION, plannedMinutes: 50 },
    ]);
    expect(running[0].nodeId).toBeUndefined();
  });

  test("firstRun_withName_createsTheNodeAtTheRootAndStartsOnIt", async () => {
    const recording = await openFirstRun();
    fireEvent.change(screen.getByLabelText("What are you working on?"), {
      target: { value: "Rewrite the pricing page" },
    });

    fireEvent.click(
      screen.getByRole("button", { name: /Start the first cycle/ }),
    );

    expect(
      await screen.findByText("Rewrite the pricing page", {
        selector: ".task-strip-name",
      }),
    ).toBeDefined();
    const [node] = (await allNodes(recording.client)).filter(
      (listed) => listed.id !== "",
    );
    expect(node).toMatchObject({
      name: "Rewrite the pricing page",
      estimates: [
        { mode: FocusMode.EXECUTION, cycleMinutes: 50, cycleCount: 1 },
      ],
    });
    expect(node.parentId).toBeUndefined();
    expect(node.cycles).toHaveLength(1);
  });

  test("firstRun_steppers_updateTheSubtotalAndTheSummary", async () => {
    await openFirstRun();

    fireEvent.click(
      screen.getByRole("button", { name: "More Deep Focus cycles" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "More Deep Focus cycles" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Fewer Execution minutes" }),
    );

    expect(screen.getByLabelText("Estimate summary").textContent).toBe(
      "3 cycles · 3h 45m",
    );
  });

  test("firstRun_allCountsZero_startsWithNoEstimate", async () => {
    const recording = await openFirstRun();
    fireEvent.change(screen.getByLabelText("What are you working on?"), {
      target: { value: "Taxes" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Fewer Execution cycles" }),
    );

    const start = screen.getByRole("button", { name: /Start the first cycle/ });
    expect((start as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(start);

    await screen.findByRole("timer", { name: "Time left" });
    const [node] = (await allNodes(recording.client)).filter(
      (listed) => listed.id !== "",
    );
    expect(node.estimates).toEqual([]);
  });

  test("firstRun_selectAnotherRow_startsThatModeAtItsLength", async () => {
    const recording = await openFirstRun();

    fireEvent.click(screen.getByRole("radio", { name: "Shallow" }));
    const start = screen.getByRole("button", { name: /Start the first cycle/ });
    expect(within(start).getByText("Shallow · 25 min")).toBeDefined();
    fireEvent.click(start);

    await screen.findByRole("timer", { name: "Time left" });
    const cycles = (await allNodes(recording.client)).flatMap(
      (node) => node.cycles,
    );
    expect(cycles).toMatchObject([
      { mode: FocusMode.SHALLOW, plannedMinutes: 25 },
    ]);
  });

  test("firstRun_lostResponses_retryWithTheSameKeys", async () => {
    const recording = await openFirstRun();
    fireEvent.change(screen.getByLabelText("What are you working on?"), {
      target: { value: "Taxes" },
    });

    recording.loseNextResponse();
    fireEvent.click(
      screen.getByRole("button", { name: /Start the first cycle/ }),
    );

    await screen.findByRole("timer", { name: "Time left" });
    expect(recording.createNodeRequestIds).toHaveLength(2);
    expect(new Set(recording.createNodeRequestIds).size).toBe(1);
    expect(recording.createCycleRequestIds).toHaveLength(1);
    const nodes = (await allNodes(recording.client)).filter(
      (listed) => listed.id !== "",
    );
    expect(nodes).toHaveLength(1);
  });

  test("firstRun_secondPressAfterAFailedStart_reusesTheNode", async () => {
    const recording = await openFirstRun();
    fireEvent.change(screen.getByLabelText("What are you working on?"), {
      target: { value: "Taxes" },
    });
    recording.failNext("CreateCycle", Code.Internal);

    fireEvent.click(
      screen.getByRole("button", { name: /Start the first cycle/ }),
    );
    await screen.findByRole("alert");
    fireEvent.click(
      screen.getByRole("button", { name: /Start the first cycle/ }),
    );

    await screen.findByRole("timer", { name: "Time left" });
    expect(new Set(recording.createNodeRequestIds).size).toBe(1);
    expect(new Set(recording.createCycleRequestIds).size).toBe(1);
    const nodes = (await allNodes(recording.client)).filter(
      (listed) => listed.id !== "",
    );
    expect(nodes).toHaveLength(1);
  });
});
