import { Code } from "@connectrpc/connect";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "../App";
import type { LedgerClient } from "../api/ledgerClient";
import { exampleExpected, exampleNow } from "../ledger/exampleData";
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

async function openReport(client: LedgerClient) {
  renderApp(client);
  const nav = await screen.findByRole("navigation", { name: "Views" });
  fireEvent.click(within(nav).getByRole("button", { name: "Report" }));
  return screen.findByRole("table", { name: "Node × mode" });
}

function choosePeriod(label: string) {
  fireEvent.click(
    within(screen.getByRole("group", { name: "Period" })).getByRole("button", {
      name: label,
    }),
  );
}

/** The cells of the cross-tab row whose header starts with `name`. */
function crossTabRow(table: HTMLElement, name: string) {
  const row = within(table)
    .getAllByRole("row")
    .find((candidate) =>
      within(candidate).queryByRole("rowheader")?.textContent?.startsWith(name),
    );
  if (!row) throw new Error(`no cross-tab row ${name}`);
  return within(row)
    .getAllByRole("cell")
    .map((cell) => cell.textContent);
}

describe("Report", () => {
  test("report_allTime_crossTabMatchesTheSharedExampleData", async () => {
    await openReport(recordingClient(exampleNodesWithNothingRunning()).client);

    choosePeriod("All");

    const table = await screen.findByRole("table", { name: "Node × mode" });
    await vi.waitFor(() =>
      expect(crossTabRow(table, "All")).toEqual([
        "335",
        "150",
        "80",
        "565",
        "100%",
      ]),
    );
    const book = exampleExpected.tree[0].rolledUp;
    expect(crossTabRow(table, "Book")).toEqual([
      String(book.minutesByMode.FOCUS_MODE_DEEP_FOCUS),
      String(book.minutesByMode.FOCUS_MODE_EXECUTION),
      String(book.minutesByMode.FOCUS_MODE_SHALLOW),
      String(book.minutes),
      "87%",
    ]);
    expect(crossTabRow(table, "Inbox")).toEqual(["—", "50", "25", "75", "13%"]);
  });

  test("report_thisWeekInUtc_totalsMatchTheSharedWeekTotals", async () => {
    const table = await openReport(
      recordingClient(exampleNodesWithNothingRunning()).client,
    );

    const week = exampleExpected.periods[0].weekTotals;
    await vi.waitFor(() =>
      expect(crossTabRow(table, "All")[3]).toBe(String(week.minutes)),
    );
    expect(screen.getByRole("heading", { name: "This week" })).toBeDefined();
    expect(screen.getByText(/26 Oct – 1 Nov/)).toBeDefined();
  });

  test("report_expandRow_showsItsChildrenIncludingClosedOnes", async () => {
    await openReport(recordingClient(exampleNodesWithNothingRunning()).client);
    choosePeriod("All");
    const table = await screen.findByRole("table", { name: "Node × mode" });
    await vi.waitFor(() => expect(crossTabRow(table, "Book")).toBeDefined());
    expect(within(table).queryByText("Chapter 2")).toBeNull();

    fireEvent.click(within(table).getByRole("button", { name: "Book" }));

    expect(crossTabRow(table, "Chapter 2")).toEqual([
      "—",
      "—",
      "55",
      "55",
      "10%",
    ]);
    expect(within(table).getByText("Chapter 1")).toBeDefined();
    expect(within(table).queryByText("Notes")).toBeNull();
  });

  test("report_estimatesAndPlanned_useTheRollUpCode", async () => {
    await openReport(recordingClient(exampleNodesWithNothingRunning()).client);
    choosePeriod("All");

    const estimated = await screen.findByRole("table", {
      name: "Estimated against actual",
    });
    await vi.waitFor(() =>
      expect(within(estimated).getAllByRole("row")[1].textContent).toBe(
        "Book53-40%",
      ),
    );
    const planned = screen.getByRole("table", {
      name: "Planned against actual",
    });
    const deep = exampleExpected.plannedVsActual.FOCUS_MODE_DEEP_FOCUS;
    expect(within(planned).getAllByRole("row")[1].textContent).toBe(
      `Deep Focus${deep.doneCycles}6h 00m5h 35m-7%`,
    );
  });

  test("report_lastWeek_sendsThePreviousWeekAsThePeriod", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    const listNodes = vi.spyOn(recording.client, "listNodes");
    await openReport(recording.client);

    choosePeriod("Last week");

    await vi.waitFor(() => {
      const last = listNodes.mock.calls.at(-1)?.[0];
      expect(last?.includeClosed).toBe(true);
      expect(Number(last?.period?.start?.seconds)).toBe(
        Date.parse("2026-10-19T00:00:00Z") / 1000,
      );
      expect(Number(last?.period?.end?.seconds)).toBe(
        Date.parse("2026-10-26T00:00:00Z") / 1000,
      );
    });
  });

  test("report_customRange_coversTheChosenDays", async () => {
    const table = await openReport(
      recordingClient(exampleNodesWithNothingRunning()).client,
    );
    choosePeriod("Custom");

    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "2026-10-20" },
    });
    fireEvent.change(screen.getByLabelText("To"), {
      target: { value: "2026-10-20" },
    });

    await vi.waitFor(() =>
      expect(crossTabRow(table, "All")).toEqual([
        "90",
        "50",
        "—",
        "140",
        "100%",
      ]),
    );
  });

  test("report_screen_hasNothingToEdit", async () => {
    await openReport(recordingClient(exampleNodesWithNothingRunning()).client);

    expect(screen.queryAllByRole("textbox")).toEqual([]);
    expect(screen.queryAllByRole("spinbutton")).toEqual([]);
  });

  test("report_loadFails_showsTheErrorAndThenRetries", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    renderApp(recording.client);
    const nav = await screen.findByRole("navigation", { name: "Views" });
    // StrictMode runs the load effect twice, so both runs fail.
    recording.failNext("ListNodes", Code.Internal, 2);

    fireEvent.click(within(nav).getByRole("button", { name: "Report" }));

    expect(await screen.findByRole("alert")).toBeDefined();
    choosePeriod("All");
    expect(
      await screen.findByRole("table", { name: "Node × mode" }),
    ).toBeDefined();
  });
});
