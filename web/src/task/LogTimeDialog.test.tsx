import { create } from "@bufbuild/protobuf";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "../App";
import type { LedgerClient } from "../api/ledgerClient";
import {
  FocusMode,
  type NodePb,
  SettingsPbSchema,
} from "../gen/focusledger/v1/model_pb";
import { exampleNow } from "../ledger/exampleData";
import { weekRange } from "../ledger/period";
import {
  exampleNodesWithNothingRunning,
  recordingClient,
} from "../testing/appHarness";
import { openTasks } from "../testing/navigation";
import { INBOX_ID, type TodayData } from "../today/todayModel";
import { LogTimeDialog } from "./LogTimeDialog";
import type { LogDraft } from "./logTimeModel";

const NOTES = "00000000-0000-4000-8000-00000000000d";

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
    week: weekRange(exampleNow, "UTC"),
  } as TodayData;
}

function renderDialog(
  options: {
    nodeId?: string;
    onLog?: (draft: LogDraft) => Promise<void>;
  } = {},
) {
  const nodes = exampleNodesWithNothingRunning();
  const onClose = vi.fn();
  const listCycles = vi.fn(async () => nodes.flatMap((node) => node.cycles));
  render(
    <LogTimeDialog
      data={dataOf(nodes)}
      now={exampleNow}
      timeZone="UTC"
      initialNodeId={options.nodeId ?? NOTES}
      listCycles={listCycles}
      onSaveTask={vi.fn()}
      onLog={options.onLog}
      onClose={onClose}
    />,
  );
  return { onClose, listCycles };
}

const dialog = () => screen.getByRole("dialog", { name: "Log time" });
const taskField = () => screen.getByRole("button", { name: /^Task: / });
const whenRow = () => screen.getByRole("button", { name: /^When/ });
const logButton = () =>
  screen.getByRole("button", { name: "Log" }) as HTMLButtonElement;

function enterStart(text: string, meridiem: "am" | "pm") {
  if (!screen.queryByRole("dialog", { name: "When" }))
    fireEvent.click(whenRow());
  fireEvent.change(screen.getByRole("textbox", { name: "Start time" }), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole("button", { name: meridiem }));
}

function addCycle(mode: string) {
  fireEvent.click(
    screen.getByRole("button", { name: `${mode} cycles: One cycle more` }),
  );
}

describe("Log time dialog (README Log time)", () => {
  test("logTime_task_showsTheTaskAndItsPath_orNotSureYet", () => {
    renderDialog();
    expect(taskField().textContent).toBe("NotesBook / Chapter 1");
  });

  test("logTime_inbox_isNotSureYet", () => {
    renderDialog({ nodeId: INBOX_ID });
    expect(taskField().textContent).toBe("Not sure yetgoes to Untagged");
  });

  test("logTime_taskField_opensThePicker_andEscapeClosesOnlyThePicker", () => {
    renderDialog();

    fireEvent.click(taskField());
    const search = screen.getByRole("combobox", { name: /search tasks/i });
    fireEvent.keyDown(search, { key: "Escape" });

    expect(
      screen.queryByRole("combobox", { name: /search tasks/i }),
    ).toBeNull();
    expect(dialog()).toBeDefined();
  });

  test("logTime_pickerPick_changesTheTask", () => {
    renderDialog();

    fireEvent.click(taskField());
    fireEvent.click(
      screen
        .getAllByRole("option")
        .find((option) => option.textContent?.startsWith("Book")) as Element,
    );

    expect(taskField().textContent).toBe("Book");
  });

  test("logTime_calendar_marksTodayAndCycleDays_andGreysTheFuture", async () => {
    const { listCycles } = renderDialog();

    fireEvent.click(whenRow());

    const today = screen.getByRole("button", { name: "Sun 1 Nov" });
    expect(today.getAttribute("aria-current")).toBe("date");
    expect(
      (screen.getByRole("button", { name: "Mon 2 Nov" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await waitFor(() => expect(today.dataset.dot).toBe("true"));
    expect(listCycles).toHaveBeenCalled();
  });

  test("logTime_calendarDay_changesWhen_andEscapeClosesOnlyTheCalendar", () => {
    renderDialog();
    expect(whenRow().textContent).toContain("Today");

    fireEvent.click(whenRow());
    fireEvent.click(screen.getByRole("button", { name: "Earlier month" }));
    fireEvent.click(screen.getByRole("button", { name: "Sat 31 Oct" }));
    expect(whenRow().textContent).toContain("Yesterday");
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Start time" }), {
      key: "Escape",
    });

    expect(screen.queryByRole("dialog", { name: "When" })).toBeNull();
    expect(dialog()).toBeDefined();
  });

  test("logTime_startTime_showsInWhen_andAWrongTimeShowsNone", () => {
    renderDialog();

    enterStart("3:30", "pm");
    expect(whenRow().textContent).toContain("Today · 3:30 pm");

    enterStart("13:30", "pm");
    expect(whenRow().textContent).not.toContain("·");
  });

  test("logTime_end_isTheStartPlusEveryCountedCycle", () => {
    renderDialog();
    enterStart("3:30", "pm");
    expect(screen.queryByText(/→/)).toBeNull();
    fireEvent.keyDown(dialog(), { key: "Escape" });

    addCycle("Deep Focus");
    addCycle("Execution");
    fireEvent.click(whenRow());

    // 90 + 50 minutes from 3:30 pm.
    expect(screen.getByText("→ 5:50 pm")).toBeDefined();
  });

  test("logTime_rowWithCycles_lightsUp", () => {
    renderDialog();

    addCycle("Execution");

    const lit = [...document.querySelectorAll(".task-estimate[data-lit]")];
    expect(lit.map((row) => row.getAttribute("data-mode"))).toEqual([
      "execution",
    ]);
  });

  test("logTime_log_needsAStartTimeAndACycle", async () => {
    const onLog = vi.fn<(draft: LogDraft) => Promise<void>>(
      async () => undefined,
    );
    renderDialog({ onLog });
    expect(logButton().disabled).toBe(true);

    addCycle("Deep Focus");
    expect(logButton().disabled).toBe(true);
    enterStart("9:00", "am");
    fireEvent.keyDown(dialog(), { key: "Escape" });
    expect(logButton().disabled).toBe(false);
    fireEvent.click(logButton());

    await waitFor(() => expect(onLog).toHaveBeenCalledOnce());
    expect(onLog.mock.calls[0][0]).toMatchObject({
      nodeId: NOTES,
      day: "2026-11-01",
      start: "09:00",
    });
    expect(onLog.mock.calls[0][0].time[FocusMode.DEEP_FOCUS]).toEqual({
      cycleMinutes: 90,
      cycleCount: 1,
    });
  });

  test("logTime_withoutAWriter_logStaysDisabled", () => {
    renderDialog();
    addCycle("Deep Focus");
    enterStart("9:00", "am");

    expect(logButton().disabled).toBe(true);
  });

  test("logTime_cancel_closesAndWritesNothing", () => {
    const onLog = vi.fn<(draft: LogDraft) => Promise<void>>(
      async () => undefined,
    );
    const { onClose } = renderDialog({ onLog });
    addCycle("Deep Focus");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(onLog).not.toHaveBeenCalled();
  });
});

describe("Log time buttons (README Log time)", () => {
  async function openApp(client: LedgerClient) {
    render(
      <StrictMode>
        <App client={client} timeZone="UTC" retryDelaysMs={[0]} />
      </StrictMode>,
    );
    await screen.findByRole("button", { name: "Start" });
    await openTasks();
  }

  test("tasksPage_logTime_opensOnTheLastTaskWorked_andCancelWritesNothing", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    await openApp(recording.client);

    fireEvent.click(screen.getByRole("button", { name: "Log time" }));

    expect(taskField().textContent).toBe("NotesBook / Chapter 1");
    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Log time" })).toBeNull();
    expect(recording.createCycleRequestIds).toEqual([]);
  });

  test("taskPage_logTime_opensOnThatTask", async () => {
    await openApp(recordingClient(exampleNodesWithNothingRunning()).client);
    fireEvent.click(await screen.findByRole("listitem", { name: "Book" }));
    await screen.findByRole("button", { name: "Edit task, Book" });

    fireEvent.click(screen.getByRole("button", { name: "Log time" }));

    expect(taskField().textContent).toBe("Book");
  });
});
