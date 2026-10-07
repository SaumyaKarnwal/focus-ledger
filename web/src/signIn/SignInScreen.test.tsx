import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Code, ConnectError } from "@connectrpc/connect";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "../App";
import type { GuestLedger, Ledger } from "../api/ledger";
import { newRequestId } from "../api/requestId";
import { FocusMode } from "../gen/focusledger/v1/model_pb";
import { hadAccount, setHadAccount } from "../session/accountFlag";
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
    const { nodes } = await guest.ledger.listNodes({});
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
});

describe("Sign in from a guest (README Guest mode, issue 275)", () => {
  /** A guest ledger with one hand-logged cycle. */
  async function guestWithHistory(): Promise<GuestLedger> {
    const guest = guestLedger();
    await guest.ledger.createCycle({
      requestId: newRequestId(),
      mode: FocusMode.SHALLOW,
      minutes: 25,
      startedAt: {
        seconds: BigInt(exampleNow.getTime() / 1000 - 3600),
        nanos: 0,
      },
    });
    return guest;
  }

  function renderWith(client: Ledger, guest: GuestLedger) {
    render(
      <StrictMode>
        <App client={client} guest={guest} timeZone="UTC" retryDelaysMs={[0]} />
      </StrictMode>,
    );
  }

  const guestCycles = async (guest: GuestLedger) =>
    (await guest.ledger.listNodes({})).nodes.flatMap((node) => node.cycles);

  test("signIn_success_deletesTheGuestData_andShowsTheAccount", async () => {
    const guest = await guestWithHistory();
    renderWith(signedOutClient().client, guest);
    // No warning: the pill goes straight to the sign-in screen.
    fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));

    fireEvent.click(
      await screen.findByRole("button", { name: "Continue with Google" }),
    );

    expect(
      await screen.findByRole("button", { name: "Your account" }),
    ).toBeDefined();
    expect(await guestCycles(guest)).toEqual([]);
    expect(hadAccount()).toBe(true);
  });

  test("signIn_failure_keepsTheGuestData", async () => {
    const guest = await guestWithHistory();
    const { client } = signedOutClient();
    vi.spyOn(client, "signIn").mockRejectedValue(
      new ConnectError("the token failed the checks", Code.Unauthenticated),
    );
    renderWith(client, guest);
    // No warning: the pill goes straight to the sign-in screen.
    fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));

    fireEvent.click(
      await screen.findByRole("button", { name: "Continue with Google" }),
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Continue with Google" }),
      ).toBeDefined(),
    );
    expect(await guestCycles(guest)).toHaveLength(1);
    expect(hadAccount()).toBe(false);
  });

  test("signOut_startsAnEmptyGuestSession_andClearsTheFlag", async () => {
    const guest = await guestWithHistory();
    const { client } = recordingClient(exampleNodesWithNothingRunning());
    renderWith(client, guest);
    await screen.findByRole("button", { name: "Your account" });
    expect(hadAccount()).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Your account" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    confirmSignOut();

    expect(
      await screen.findByRole("button", { name: "Sign in" }),
    ).toBeDefined();
    expect(await guestCycles(guest)).toEqual([]);
    expect(hadAccount()).toBe(false);
  });

  test("expiredSession_withoutTheFlag_opensGuestMode", async () => {
    renderWith(signedOutClient().client, guestLedger());

    expect(
      await screen.findByRole("button", { name: "Sign in" }),
    ).toBeDefined();
    expect(
      screen.queryByRole("heading", { name: "Your session ended" }),
    ).toBeNull();
  });
});

describe("A session that ends (issue 283)", () => {
  afterEach(() => {
    delete window.google;
  });

  /** Google Identity Services as the app uses it. `shows` false skips the prompt. */
  function fakeGoogle(shows: boolean) {
    let callback: ((response: { credential: string }) => void) | undefined;
    const initialize = vi.fn(
      (config: {
        client_id: string;
        callback: (response: { credential: string }) => void;
        auto_select?: boolean;
      }) => {
        callback = config.callback;
      },
    );
    const prompt = vi.fn(
      (onMoment?: (moment: { isSkippedMoment: () => boolean }) => void) => {
        if (!shows) onMoment?.({ isSkippedMoment: () => true });
      },
    );
    window.google = {
      accounts: { id: { initialize, renderButton: vi.fn(), prompt } },
    };
    return {
      initialize,
      prompt,
      chooseAccount: (idToken: string) => callback?.({ credential: idToken }),
    };
  }

  const google = { kind: "google", clientId: "test-client" } as const;

  async function expireDuringARunningCycle(client: Ledger) {
    renderApp(client, google);
    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    await screen.findByRole("button", { name: "Pause" });
    await client.signOut({});
    fireEvent.click(screen.getByRole("button", { name: /Stop and log/ }));
  }

  test("expiry_showsGooglesChooserOverTheCurrentScreen", async () => {
    const fake = fakeGoogle(true);
    const { client } = recordingClient(exampleNodesWithNothingRunning());

    await expireDuringARunningCycle(client);

    await waitFor(() => expect(fake.prompt).toHaveBeenCalledOnce());
    expect(fake.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ client_id: "test-client", auto_select: false }),
    );
    expect(screen.getByRole("button", { name: "Pause" })).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Sign in" })).toBeNull();
  });

  test("expiry_credential_signsInAndTheCycleGoesOn", async () => {
    const fake = fakeGoogle(true);
    const { client } = recordingClient(exampleNodesWithNothingRunning());
    const signIn = vi.spyOn(client, "signIn");
    await expireDuringARunningCycle(client);
    await waitFor(() => expect(fake.prompt).toHaveBeenCalledOnce());

    fake.chooseAccount("chosen-id-token");

    await waitFor(() => expect(signIn).toHaveBeenCalledOnce());
    expect(signIn.mock.calls[0][0].credential).toEqual({
      case: "googleIdToken",
      value: "chosen-id-token",
    });
    expect(await client.getAccount({})).toBeDefined();
    expect(screen.getByRole("button", { name: "Pause" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Sign in again" })).toBeNull();
  });

  test("expiry_promptCannotShow_leavesASignInAgainPill", async () => {
    const fake = fakeGoogle(false);
    const { client } = recordingClient(exampleNodesWithNothingRunning());
    await expireDuringARunningCycle(client);

    const pill = await screen.findByRole("button", { name: "Sign in again" });
    expect(screen.getByRole("button", { name: "Pause" })).toBeDefined();
    fireEvent.click(pill);
    await waitFor(() => expect(fake.prompt).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole("button", { name: "Your account" }));
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Keep going as a guest" }),
    );
    expect(
      await screen.findByRole("button", { name: "Sign in" }),
    ).toBeDefined();
    expect(hadAccount()).toBe(false);
  });

  test("expiry_atLoad_promptsOnTheLoadingPage_andACredentialLoadsTheAccount", async () => {
    const fake = fakeGoogle(true);
    setHadAccount(true);
    const { client } = signedOutClient();
    renderApp(client, google);

    await waitFor(() => expect(fake.prompt).toHaveBeenCalledOnce());
    expect(screen.queryByRole("heading", { name: "Sign in" })).toBeNull();
    fake.chooseAccount("chosen-id-token");

    expect(
      await screen.findByRole("button", { name: "Your account" }),
    ).toBeDefined();
  });
  test("expiry_atLoad_promptCannotShow_offersSignInAgainAndGuest", async () => {
    fakeGoogle(false);
    setHadAccount(true);
    renderApp(signedOutClient().client, google);

    expect(
      await screen.findByRole("button", { name: "Sign in again" }),
    ).toBeDefined();
    fireEvent.click(
      screen.getByRole("button", { name: "Keep going as a guest" }),
    );

    expect(
      await screen.findByRole("button", { name: "Sign in" }),
    ).toBeDefined();
    expect(hadAccount()).toBe(false);
  });
});
