import { fireEvent, render, screen, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "../App";
import type { LedgerClient } from "../api/ledgerClient";
import { exampleNow } from "../ledger/exampleData";
import { weekRange } from "../ledger/period";
import {
  exampleNodesWithNothingRunning,
  recordingClient,
} from "../testing/appHarness";
import { openFromTasks } from "../testing/navigation";
import { formatMinutes } from "../today/todayModel";
import { cyclesIn, minutesOf } from "./reportCards";

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(exampleNow);
});

afterEach(() => {
  vi.useRealTimers();
});

async function openReport(client: LedgerClient) {
  render(
    <StrictMode>
      <App client={client} timeZone="UTC" retryDelaysMs={[0]} />
    </StrictMode>,
  );
  await openFromTasks("Report");
  return screen.findByRole("heading", { name: "This week", level: 1 });
}

function pickRange(label: string) {
  fireEvent.click(
    within(screen.getByRole("group", { name: "Range" })).getByRole("button", {
      name: label,
    }),
  );
}

function card(name: string) {
  return within(screen.getByRole("region", { name }));
}

describe("Report v2 (boards R-Report-*)", () => {
  test("report_opensOnThisWeek_withItsDatesAndTotal", async () => {
    await openReport(recordingClient(exampleNodesWithNothingRunning()).client);

    const thisWeek = cyclesIn(
      exampleNodesWithNothingRunning(),
      weekRange(exampleNow, "UTC"),
    );
    expect(
      screen.getByText("Mon 26 Oct – Sun 1 November, so far"),
    ).toBeDefined();
    expect((await screen.findByLabelText("Total")).textContent).toBe(
      formatMinutes(minutesOf(thisWeek)),
    );
  });

  test("report_steps_earlierAndLater_laterStopsAtNow", async () => {
    await openReport(recordingClient(exampleNodesWithNothingRunning()).client);
    const later = screen.getByRole("button", {
      name: "Later",
    }) as HTMLButtonElement;
    expect(later.disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Earlier" }));
    expect(
      screen.getByRole("heading", { name: "Last week", level: 1 }),
    ).toBeDefined();
    expect(later.disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Earlier" }));
    expect(screen.getByText("2 weeks ago")).toBeDefined();

    fireEvent.click(later);
    fireEvent.click(later);
    expect(
      screen.getByRole("heading", { name: "This week", level: 1 }),
    ).toBeDefined();
  });

  test("report_today_showsTheKindOfFocusOfTheDay", async () => {
    await openReport(recordingClient(exampleNodesWithNothingRunning()).client);

    pickRange("Today");

    expect(
      screen.getByRole("heading", { name: "Today", level: 1 }),
    ).toBeDefined();
    const kinds = await card("Kind of focus").findAllByRole("listitem");
    expect(kinds.map((item) => item.textContent?.slice(0, 10))).toEqual([
      expect.stringContaining("Deep Focus"),
      expect.stringContaining("Execution"),
      expect.stringContaining("Shallow"),
    ]);
  });

  test("report_whereItWent_rollsUpToTopLevelTasksAndKeepsUntagged", async () => {
    await openReport(recordingClient(exampleNodesWithNothingRunning()).client);

    const legend = await card("Where it went").findAllByRole("listitem");
    const names = legend.map(
      (item) => item.querySelector(".split-name")?.textContent,
    );
    expect(names).toContain("Book");
    expect(names).toContain("Untagged");
    expect(names).not.toContain("Notes");
  });

  test("report_whenYouFocus_drawsACurvePerModeAndNamesThePeak", async () => {
    await openReport(recordingClient(exampleNodesWithNothingRunning()).client);

    const when = card("When you focus");
    expect(await when.findByText(/ peaks /)).toBeDefined();
    expect(
      when
        .getByRole("img", { name: /Minutes per hour/ })
        .querySelectorAll(".report-curve"),
    ).toHaveLength(3);
  });

  test("report_noCycles_saysSoInEachCard", async () => {
    await openReport(recordingClient([]).client);

    expect(await screen.findAllByText("No cycles in this range.")).toHaveLength(
      3,
    );
  });

  test("report_custom_showsTheDatesAndNamesTheSpan", async () => {
    await openReport(recordingClient(exampleNodesWithNothingRunning()).client);

    pickRange("Custom");

    expect(screen.getByLabelText("From")).toBeDefined();
    expect(screen.getByLabelText("To")).toBeDefined();
    expect(screen.getByText("7 days")).toBeDefined();
    expect(
      screen.getByRole("heading", { name: "26 Oct – 1 Nov", level: 1 }),
    ).toBeDefined();
  });

  test("report_part2_showsSetAndDoFinishedBarsAndYourYear", async () => {
    await openReport(recordingClient(exampleNodesWithNothingRunning()).client);

    expect(
      (await card("What you set, what you do").findAllByRole("listitem"))
        .length,
    ).toBe(3);
    expect(
      card("Cycles you finished").getAllByText(/^\d+ of \d+$/),
    ).toHaveLength(3);
    expect(card("Your week").getAllByRole("listitem")).toHaveLength(7);
    const year = await screen.findByRole("region", { name: "Your year" });
    expect(within(year).getByText("days in a row")).toBeDefined();
    expect(within(year).getByText(/days with focus since last/)).toBeDefined();
  });

  test("report_smallCard_followsTheRange", async () => {
    await openReport(recordingClient(exampleNodesWithNothingRunning()).client);

    pickRange("Today");
    expect(
      await screen.findByRole("region", { name: "This week so far" }),
    ).toBeDefined();
    pickRange("Month");
    expect(
      await screen.findByRole("region", { name: "Week by week" }),
    ).toBeDefined();
  });

  test("report_header_marksReportAsTheCurrentPage", async () => {
    await openReport(recordingClient(exampleNodesWithNothingRunning()).client);

    expect(
      within(screen.getByRole("navigation", { name: "Views" }))
        .getByRole("button", { name: "Report" })
        .getAttribute("aria-current"),
    ).toBe("page");
  });
});
