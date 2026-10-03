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
import { openFromTasks } from "../testing/navigation";
import { changedPaths } from "./settingsModel";

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

async function openSettings(client: LedgerClient) {
  renderApp(client);
  await openFromTasks("Settings");
  return screen.findByRole("heading", { name: "Settings" });
}

describe("Settings", () => {
  test("settings_open_showsTheStoredValuesAndNothingElse", async () => {
    await openSettings(
      recordingClient(exampleNodesWithNothingRunning()).client,
    );

    expect(
      screen.getByRole("status", { name: "Deep Focus length" }).textContent,
    ).toBe("90");
    expect(
      screen.getByRole("status", { name: "Execution length" }).textContent,
    ).toBe("50");
    expect(
      screen.getByRole("status", { name: "Shallow length" }).textContent,
    ).toBe("25");
    expect(
      screen.getByRole("status", { name: "Break length" }).textContent,
    ).toBe("5");
    expect(
      (screen.getByRole("checkbox", { name: /Sound/ }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(
      (
        screen.getByRole("checkbox", {
          name: /Notifications/,
        }) as HTMLInputElement
      ).checked,
    ).toBe(false);
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  });

  test("settings_changeTwoFields_sendsOnlyThosePathsAndTheNextStartUsesThem", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    const update = vi.spyOn(recording.client, "updateSettings");
    await openSettings(recording.client);

    fireEvent.click(
      screen.getByRole("button", { name: "Longer Deep Focus length" }),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: /Notifications/ }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(await screen.findByRole("list", { name: "Nodes" })).toBeDefined();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].updateMask?.paths).toEqual([
      "deep_focus_minutes",
      "notifications_enabled",
    ]);
    const { settings } = await recording.client.getSettings({});
    expect(settings).toMatchObject({
      deepFocusMinutes: 95,
      notificationsEnabled: true,
    });
    fireEvent.click(
      within(screen.getByRole("navigation", { name: "Views" })).getByRole(
        "button",
        { name: "Today" },
      ),
    );
    expect(
      (await screen.findByRole("status", { name: "Length" })).textContent,
    ).toBe("95:00");
  });

  test("settings_doneWithNoChange_sendsNothing", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    const update = vi.spyOn(recording.client, "updateSettings");
    await openSettings(recording.client);

    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(await screen.findByRole("list", { name: "Nodes" })).toBeDefined();
    expect(update).not.toHaveBeenCalled();
  });

  test("settings_changeThenBack_countsAsNoChange", async () => {
    const recording = recordingClient(exampleNodesWithNothingRunning());
    const update = vi.spyOn(recording.client, "updateSettings");
    await openSettings(recording.client);

    fireEvent.click(
      screen.getByRole("button", { name: "Longer Break length" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Shorter Break length" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    await screen.findByRole("list", { name: "Nodes" });
    expect(update).not.toHaveBeenCalled();
  });

  test("settings_breakLength_staysWithinOneToSixty", async () => {
    await openSettings(
      recordingClient(exampleNodesWithNothingRunning()).client,
    );
    const shorter = screen.getByRole("button", {
      name: "Shorter Break length",
    });

    [1, 2, 3, 4, 5, 6].forEach(() => fireEvent.click(shorter));

    expect(
      screen.getByRole("status", { name: "Break length" }).textContent,
    ).toBe("1");
  });

  test("settings_fromTree_returnsToTheTree", async () => {
    const { client } = recordingClient(exampleNodesWithNothingRunning());
    renderApp(client);
    const nav = await screen.findByRole("navigation", { name: "Views" });
    fireEvent.click(within(nav).getByRole("button", { name: "Tasks" }));
    fireEvent.click(
      within(screen.getByRole("navigation", { name: "Views" })).getByRole(
        "button",
        { name: "Settings" },
      ),
    );

    fireEvent.click(await screen.findByRole("button", { name: "Done" }));

    expect(await screen.findByRole("listitem", { name: "Book" })).toBeDefined();
  });

  test("changedPaths_twoFields_areInAFixedOrder", () => {
    const before = {
      deepFocusMinutes: 90,
      executionMinutes: 50,
      shallowMinutes: 25,
      breakMinutes: 5,
      soundEnabled: true,
      notificationsEnabled: false,
    };

    expect(
      changedPaths(before, {
        ...before,
        soundEnabled: false,
        shallowMinutes: 30,
      }),
    ).toEqual(["shallow_minutes", "sound_enabled"]);
  });
});
