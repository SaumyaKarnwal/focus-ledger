import { fireEvent, render, screen } from "@testing-library/react";
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
import { FAKE_ID_TOKEN, type SignInMethod } from "./signInMethod";

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(exampleNow);
});

afterEach(() => {
  vi.useRealTimers();
});

function renderApp(client: LedgerClient, signInMethod?: SignInMethod) {
  return render(
    <StrictMode>
      <App
        client={client}
        timeZone="UTC"
        retryDelaysMs={[0]}
        signInMethod={signInMethod}
      />
    </StrictMode>,
  );
}

function signedOutClient(nodes = exampleNodesWithNothingRunning()) {
  return recordingClient(nodes, { signedIn: false });
}

describe("Sign-in", () => {
  test("signIn_noSession_showsOnlyTheGoogleAction", async () => {
    renderApp(signedOutClient().client);

    expect(
      await screen.findByRole("heading", { name: "Sign in" }),
    ).toBeDefined();
    expect(
      screen.getAllByRole("button").map((button) => button.textContent),
    ).toEqual(["Sign in with Google"]);
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  test("signIn_google_sendsTheIdTokenAndOpensToday", async () => {
    const { client } = signedOutClient();
    const signIn = vi.spyOn(client, "signIn");
    renderApp(client);

    fireEvent.click(
      await screen.findByRole("button", { name: "Sign in with Google" }),
    );

    expect(await screen.findByRole("button", { name: "Start" })).toBeDefined();
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(signIn.mock.calls[0][0].credential).toEqual({
      case: "googleIdToken",
      value: FAKE_ID_TOKEN,
    });
  });

  test("signIn_newAccountWithNoData_landsOnStartEmpty", async () => {
    renderApp(signedOutClient([]).client);

    fireEvent.click(
      await screen.findByRole("button", { name: "Sign in with Google" }),
    );

    expect(await screen.findByRole("button", { name: "Start" })).toBeDefined();
    expect(screen.getByText("What are you working on?")).toBeDefined();
    expect(screen.queryByText(/first cycle/i)).toBeNull();
    expect(screen.queryByRole("textbox", { name: /working on/i })).toBeNull();
  });

  test("signIn_googleWithoutAClientId_saysSignInIsNotSetUp", async () => {
    renderApp(signedOutClient().client, {
      kind: "google",
      clientId: undefined,
    });

    expect((await screen.findByRole("alert")).textContent).toContain(
      "GOOGLE_CLIENT_ID",
    );
    expect(
      screen.queryByRole("button", { name: "Sign in with Google" }),
    ).toBeNull();
  });

  test("signOut_fromSettings_returnsToSignIn", async () => {
    const { client } = recordingClient(exampleNodesWithNothingRunning());
    renderApp(client);
    await openFromTasks("Settings");
    await screen.findByRole("heading", { name: "Cycles" });

    fireEvent.click(screen.getByRole("button", { name: "Your account" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));

    expect(
      await screen.findByRole("heading", { name: "Sign in" }),
    ).toBeDefined();
    await expect(client.getAccount({})).rejects.toThrow(/no session/);
  });

  test("signOut_fromTheAccountBadge_returnsToSignIn", async () => {
    const { client } = recordingClient(exampleNodesWithNothingRunning());
    renderApp(client);
    await screen.findByRole("button", { name: "Start" });

    fireEvent.click(screen.getByRole("button", { name: "Your account" }));
    expect(screen.getByText("fake.user@example.com")).toBeDefined();
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));

    expect(
      await screen.findByRole("heading", { name: "Sign in" }),
    ).toBeDefined();
  });

  test("session_endsDuringUse_nextActionOpensSignIn", async () => {
    const { client } = recordingClient(exampleNodesWithNothingRunning());
    renderApp(client);
    await screen.findByRole("button", { name: "Start" });
    await client.signOut({});

    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    expect(
      await screen.findByRole("heading", { name: "Sign in" }),
    ).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
