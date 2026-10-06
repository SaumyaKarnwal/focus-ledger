import { fireEvent, render, screen, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "../App";
import type { Ledger } from "../api/ledger";
import { exampleNow } from "../ledger/exampleData";
import {
  exampleNodesWithNothingRunning,
  guestLedger,
  recordingClient,
} from "../testing/appHarness";
import { openFromTasks } from "../testing/navigation";
import {
  PRODUCT_NAME,
  PRODUCT_NAME_MEANING,
  PRODUCT_NAME_NATIVE,
} from "../productName";
import { FAKE_ID_TOKEN, type SignInMethod } from "./signInMethod";

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(exampleNow);
});

afterEach(() => {
  vi.useRealTimers();
});

/** Answers the Sign out question (board A-Signout) with Sign out. */
function confirmSignOut() {
  fireEvent.click(
    within(screen.getByRole("alertdialog", { name: "Sign out?" })).getByRole(
      "button",
      { name: "Sign out" },
    ),
  );
}

function renderApp(client: Ledger, signInMethod?: SignInMethod) {
  return render(
    <StrictMode>
      <App
        client={client}
        guest={guestLedger()}
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

/** As a guest, the header's pill opens the sign-in screen. */
async function openSignIn() {
  fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));
  return screen.findByRole("heading", { name: "Sign in" });
}

/** Back on Start as a guest: the pill shows and the account initial does not. */
async function expectGuestStart() {
  // The pill shows only in guest mode, so it is the first thing to wait for.
  expect(await screen.findByRole("button", { name: "Sign in" })).toBeDefined();
  expect(await screen.findByRole("button", { name: "Start" })).toBeDefined();
  expect(screen.queryByRole("button", { name: "Your account" })).toBeNull();
}

describe("Sign-in", () => {
  test("guest_noSession_opensStartWithASignInPill", async () => {
    renderApp(signedOutClient().client);

    await expectGuestStart();
    expect(screen.queryByRole("heading", { name: "Sign in" })).toBeNull();
    // The guest starts with an empty ledger, not the server's rows.
    expect(screen.getByText("What are you working on?")).toBeDefined();
  });

  test("guest_cycle_staysInTheBrowserAndReachesNoServer", async () => {
    const recording = signedOutClient();
    const guest = guestLedger();
    render(
      <StrictMode>
        <App
          client={recording.client}
          guest={guest}
          timeZone="UTC"
          retryDelaysMs={[0]}
        />
      </StrictMode>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Start" }));

    expect(await screen.findByRole("button", { name: "Pause" })).toBeDefined();
    expect(recording.createCycleRequestIds).toEqual([]);
    const { nodes } = await guest.listNodes({});
    expect(nodes.flatMap((node) => node.cycles)).toHaveLength(1);
  });

  test("signIn_screen_showsTheBoardsCardAndTheGuestLink", async () => {
    renderApp(signedOutClient().client);
    await openSignIn();

    expect(screen.getByRole("heading", { name: PRODUCT_NAME })).toBeDefined();
    expect(screen.getByText(PRODUCT_NAME_NATIVE).getAttribute("lang")).toBe(
      "sa",
    );
    expect(screen.getByText(PRODUCT_NAME_MEANING)).toBeDefined();
    expect(screen.getByText(/every cycle you name follows you/)).toBeDefined();
    expect(
      screen.getAllByRole("button").map((button) => button.textContent),
    ).toEqual(["Continue with Google", "keep going without an account"]);
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  test("signIn_keepGoing_returnsToTheAppAsAGuest", async () => {
    renderApp(signedOutClient().client);
    await openSignIn();

    fireEvent.click(
      screen.getByRole("button", { name: "keep going without an account" }),
    );

    await expectGuestStart();
  });

  test("signIn_google_sendsTheIdTokenAndOpensToday", async () => {
    const { client } = signedOutClient();
    const signIn = vi.spyOn(client, "signIn");
    renderApp(client);
    await openSignIn();

    fireEvent.click(
      screen.getByRole("button", { name: "Continue with Google" }),
    );

    expect(
      await screen.findByRole("button", { name: "Your account" }),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Start" })).toBeDefined();
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(signIn.mock.calls[0][0].credential).toEqual({
      case: "googleIdToken",
      value: FAKE_ID_TOKEN,
    });
  });

  test("signIn_newAccountWithNoData_landsOnStartEmpty", async () => {
    renderApp(signedOutClient([]).client);
    await openSignIn();

    fireEvent.click(
      screen.getByRole("button", { name: "Continue with Google" }),
    );

    expect(
      await screen.findByRole("button", { name: "Your account" }),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Start" })).toBeDefined();
    expect(screen.getByText("What are you working on?")).toBeDefined();
    expect(screen.queryByText(/first cycle/i)).toBeNull();
    expect(screen.queryByRole("textbox", { name: /working on/i })).toBeNull();
  });

  test("signIn_googleWithoutAClientId_saysSignInIsNotSetUp", async () => {
    renderApp(signedOutClient().client, {
      kind: "google",
      clientId: undefined,
    });
    await openSignIn();

    expect((await screen.findByRole("alert")).textContent).toContain(
      "GOOGLE_CLIENT_ID",
    );
    expect(
      screen.queryByRole("button", { name: "Continue with Google" }),
    ).toBeNull();
  });

  test("signOut_fromSettings_leavesAGuest", async () => {
    const { client } = recordingClient(exampleNodesWithNothingRunning());
    renderApp(client);
    await openFromTasks("Settings");
    await screen.findByRole("heading", { name: "Cycles" });

    fireEvent.click(screen.getByRole("button", { name: "Your account" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    confirmSignOut();

    await expectGuestStart();
    await expect(client.getAccount({})).rejects.toThrow(/no session/);
  });

  test("signOut_fromTheAccountBadge_leavesAGuest", async () => {
    const { client } = recordingClient(exampleNodesWithNothingRunning());
    renderApp(client);
    await screen.findByRole("button", { name: "Start" });

    fireEvent.click(screen.getByRole("button", { name: "Your account" }));
    expect(screen.getByText("fake.user@example.com")).toBeDefined();
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    confirmSignOut();

    await expectGuestStart();
  });

  test("signOut_cancel_keepsTheSessionAndSendsNothing", async () => {
    const { client } = recordingClient(exampleNodesWithNothingRunning());
    const signOut = vi.spyOn(client, "signOut");
    renderApp(client);
    await screen.findByRole("button", { name: "Start" });

    fireEvent.click(screen.getByRole("button", { name: "Your account" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    const question = screen.getByRole("alertdialog", { name: "Sign out?" });
    expect(question.textContent).toContain(
      "Everything is saved to your account",
    );
    expect(document.activeElement?.textContent).toBe("Cancel");
    fireEvent.click(within(question).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("button", { name: "Start" })).toBeDefined();
    expect(signOut).not.toHaveBeenCalled();
  });

  test("signOut_escape_closesTheQuestion", async () => {
    const { client } = recordingClient(exampleNodesWithNothingRunning());
    const signOut = vi.spyOn(client, "signOut");
    renderApp(client);
    await screen.findByRole("button", { name: "Start" });

    fireEvent.click(screen.getByRole("button", { name: "Your account" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(signOut).not.toHaveBeenCalled();
  });

  test("signOut_fromTheCompactMenu_asksFirst", async () => {
    const { client } = recordingClient(exampleNodesWithNothingRunning());
    const signOut = vi.spyOn(client, "signOut");
    renderApp(client);
    await screen.findByRole("button", { name: "Start" });

    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(signOut).not.toHaveBeenCalled();
    confirmSignOut();

    await expectGuestStart();
    expect(signOut).toHaveBeenCalledTimes(1);
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
