import { Code, ConnectError } from "@connectrpc/connect";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GuestLedger, Ledger } from "./api/ledger";
import {
  type Address,
  HOME,
  parseAddress,
  pathOf,
  type View,
} from "./addresses";
import { newRequestId } from "./api/requestId";
import { withRetry } from "./api/retry";
import {
  type BellDeps,
  type BellEvent,
  browserBell,
  ringBell,
  unlockAudio,
} from "./bell/bell";
import type { Playing } from "./bell/sounds";
import { BellScreen } from "./cycle/BellScreen";
import { BreakScreen, type ComingBackTo } from "./cycle/BreakScreen";
import { ExtensionScreen } from "./cycle/ExtensionScreen";
import {
  clearExtension,
  loadExtension,
  type PendingExtension,
  saveExtension,
} from "./cycle/extensionStore";
import { clearPause, loadPause, savePause } from "./cycle/pauseStore";
import {
  extensionRemainingMs,
  formatCountdown,
  hasEnded,
  type PauseState,
  pausedMs,
  remainingMs,
} from "./cycle/timer";
import { useFocusSound } from "./bell/useFocusSound";
import { useClock } from "./session/useClock";
import {
  BREAK_NAMES,
  type BreakTimer,
  breakRemainingMs,
  breakTimerFor,
  type TimerChip,
} from "./session/sessionTimer";
import { modeKey } from "./modes/modes";
import { RunningScreen } from "./cycle/RunningScreen";
import type { CyclePb } from "./gen/focusledger/v1/model_pb";
import { browserTimeZone } from "./ledger/period";
import type { LoggedMode } from "./ledger/rollup";
import { ReportScreen } from "./report/ReportScreen";
import { loadLocalSettings } from "./settings/localSettings";
import { SettingsPage } from "./settings/SettingsPage";
import { hadAccount, setHadAccount } from "./session/accountFlag";
import { GuestContext, ReauthContext } from "./session/guestSession";
import { promptGoogleSignIn } from "./signIn/googleIdentity";
import { FAKE_ID_TOKEN } from "./signIn/signInMethod";
import { SignInScreen } from "./signIn/SignInScreen";
import type { SignInMethod } from "./signIn/signInMethod";
import { TasksPage } from "./tasks/TasksPage";
import { PageHeader } from "./ui/PageHeader";
import { loadToday } from "./today/loadToday";
import { PRODUCT_NAME } from "./productName";
import { taskStrip } from "./start/startModel";
import type { LogEntry } from "./task/logTimeModel";
import { type TaskSave, writeTask } from "./task/saveTask";
import { writeLog } from "./task/writeLog";
import { StartScreen } from "./start/StartScreen";
import {
  cycleContext,
  INBOX_ID,
  knownCycles,
  MODE_NAMES,
  taskAfterCycle,
  type TodayData,
  todayModel,
} from "./today/todayModel";

type Screen =
  | { kind: "loading" }
  | { kind: "signIn" }
  | { kind: "today" }
  | { kind: "running"; cycle: CyclePb }
  | { kind: "bell"; cycle: CyclePb }
  | { kind: "extension"; cycle: CyclePb; extension: PendingExtension }
  | { kind: "break"; comingBackTo: ComingBackTo; timer: BreakTimer };

/** The screens of a cycle or a break. They stay alive while another page shows. */
function isSession(screen: Screen): boolean {
  return (
    screen.kind === "running" ||
    screen.kind === "bell" ||
    screen.kind === "extension" ||
    screen.kind === "break"
  );
}

/** The extension to resume after a reload, if its cycle still has the minutes it started with. */
function pendingExtensionFor(
  loaded: TodayData,
): { cycle: CyclePb; extension: PendingExtension } | undefined {
  const extension = loadExtension();
  if (!extension) return undefined;
  const cycle = knownCycles(loaded).find(
    (listed) => listed.id === extension.cycleId,
  );
  if (cycle?.minutes !== extension.loggedMinutes) {
    clearExtension();
    return undefined;
  }
  return { cycle, extension };
}

/** Moves the browser to an address without a page load. */
function pushAddress(address: Address) {
  const path = pathOf(address);
  if (path === window.location.pathname) return;
  window.history.pushState(null, "", path + window.location.search);
}

function replaceAddress(address: Address) {
  window.history.replaceState(
    null,
    "",
    pathOf(address) + window.location.search,
  );
}

type Props = {
  /** The server's ledger: the account's data once signed in. */
  client: Ledger;
  /** This browser's ledger, for a guest (README "Guest mode"). */
  guest: GuestLedger;
  timeZone?: string;
  retryDelaysMs?: readonly number[];
  /** main.tsx passes Google for the real backend. The default suits the fake. */
  signInMethod?: SignInMethod;
  /** The sound and the notification. Tests pass their own. */
  bell?: BellDeps;
};

function isUnauthenticated(reason: unknown): boolean {
  return ConnectError.from(reason).code === Code.Unauthenticated;
}

export function App({
  client,
  guest,
  timeZone = browserTimeZone(),
  retryDelaysMs,
  signInMethod = { kind: "fake" },
  bell = browserBell,
}: Props) {
  // No session on the server means a guest, never a sign-in wall.
  const [mode, setMode] = useState<"account" | "guest">("account");
  const active = mode === "guest" ? guest.ledger : client;
  const [data, setData] = useState<TodayData>();
  // A session that ended (#283): Google's chooser shows over the current
  // screen; if it cannot, the header shows a "Sign in again" pill.
  const [reauth, setReauth] = useState<"none" | "prompting" | "pill">("none");
  const startReauth = useRef<() => void>(() => undefined);
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    const loaded = await loadToday(active, new Date(), timeZone);
    setData(loaded);
    return loaded;
  }, [active, timeZone]);

  const act = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (reason) {
      // A session can end at any time, for example when the cookie expires.
      if (!isUnauthenticated(reason))
        setError(reason instanceof Error ? reason.message : String(reason));
      else if (hadAccount()) startReauth.current();
      else setScreen({ kind: "signIn" });
    } finally {
      setBusy(false);
    }
  }, []);

  const screenFor = useCallback(
    (loaded: TodayData): Screen => {
      const running = todayModel(loaded, new Date(), timeZone).running;
      if (running) return { kind: "running", cycle: running };
      const pending = pendingExtensionFor(loaded);
      return pending ? { kind: "extension", ...pending } : { kind: "today" };
    },
    [timeZone],
  );

  const showToday = () =>
    act(async () => {
      setScreen(screenFor(await refreshWithRetry()));
    });

  // The address is the page (README "Addresses"). A wrong address goes home.
  const [address, setAddress] = useState<Address>(() => {
    const parsed = parseAddress(window.location.pathname);
    if (!parsed) replaceAddress(HOME);
    return parsed ?? HOME;
  });
  const view = address.view;
  const navigate = (next: Address) => {
    pushAddress(next);
    setAddress(next);
  };
  const goHome = () => navigate(HOME);
  useEffect(() => {
    // Back and Forward change only the page; a cycle or break runs on.
    const followHistory = () => {
      const parsed = parseAddress(window.location.pathname);
      if (!parsed) replaceAddress(HOME);
      setAddress(parsed ?? HOME);
    };
    window.addEventListener("popstate", followHistory);
    return () => window.removeEventListener("popstate", followHistory);
  }, []);
  const [preselectedNodeId, setPreselectedNodeId] = useState<string>();
  const [preselectedMode, setPreselectedMode] = useState<LoggedMode>();
  // A page shows over a cycle or break that keeps running (README rule 7).
  const away = view !== "today";
  const session = isSession(screen);
  const openView = (next: View) => {
    navigate({ view: next });
    if (next !== "today") {
      setPreselectedNodeId(undefined);
      setPreselectedMode(undefined);
    } else if (!session) void showToday();
  };

  const openSettings = () => openView("settings");

  const [loadAttempt, setLoadAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    withRetry(
      () => loadToday(active, new Date(), timeZone),
      retryDelaysMs,
    ).then(
      (loaded) => {
        if (cancelled) return;
        if (mode === "account") setHadAccount(true);
        setData(loaded);
        setScreen(screenFor(loaded));
      },
      (reason: unknown) => {
        if (cancelled) return;
        // No session: a browser that was signed in hears that the session
        // ended; any other opens as a guest on this browser's ledger.
        if (!isUnauthenticated(reason)) setError(String(reason));
        else if (hadAccount()) startReauth.current();
        else setMode("guest");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [active, mode, timeZone, screenFor, retryDelaysMs, loadAttempt]);

  const signIn = (idToken: string) =>
    void act(async () => {
      await withRetry(
        () =>
          client.signIn({
            credential: { case: "googleIdToken", value: idToken },
          }),
        retryDelaysMs,
      );
      // Guest data never moves into an account: a sign-in removes it.
      await guest.clear();
      setHadAccount(true);
      setMode("account");
      setData(undefined);
      setScreen({ kind: "loading" });
      goHome();
      setLoadAttempt((attempt) => attempt + 1);
    });

  // Signing out leaves the app as a guest, not on a sign-in wall.
  const signOut = () =>
    void act(async () => {
      await withRetry(() => client.signOut({}), retryDelaysMs);
      // A sign-out starts an empty guest session.
      await guest.clear();
      setHadAccount(false);
      setReauth("none");
      setData(undefined);
      setMode("guest");
      setScreen({ kind: "loading" });
      goHome();
    });

  const openSignIn = () => {
    setError(undefined);
    setScreen({ kind: "signIn" });
  };

  // Back from the sign-in screen as a guest. An account whose session ended
  // becomes a guest; a guest returns to what it was doing.
  const keepGoing = () => {
    setError(undefined);
    setReauth("none");
    setHadAccount(false);
    if (mode === "guest" && data) {
      setScreen(screenFor(data));
      return;
    }
    setData(undefined);
    setMode("guest");
    setScreen({ kind: "loading" });
    setLoadAttempt((attempt) => attempt + 1);
  };

  const retryFirstLoad = () => {
    setError(undefined);
    setLoadAttempt((attempt) => attempt + 1);
  };

  const refreshWithRetry = useCallback(
    () => withRetry(refresh, retryDelaysMs),
    [refresh, retryDelaysMs],
  );

  // The account signs in again where the user is: the data reloads and a
  // running cycle goes on. Another account starts from its own Start.
  const reauthenticate = async (idToken: string) => {
    setBusy(true);
    setError(undefined);
    try {
      await withRetry(
        () =>
          client.signIn({
            credential: { case: "googleIdToken", value: idToken },
          }),
        retryDelaysMs,
      );
      setHadAccount(true);
      setReauth("none");
      if (!data) {
        setLoadAttempt((attempt) => attempt + 1);
        return;
      }
      const loaded = await refreshWithRetry();
      if (loaded.email !== data.email) {
        goHome();
        setScreen(screenFor(loaded));
      }
    } catch (reason) {
      setReauth("pill");
      if (!isUnauthenticated(reason)) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      setBusy(false);
    }
  };

  const promptReauth = () => {
    setReauth("prompting");
    if (signInMethod.kind === "google" && signInMethod.clientId) {
      void promptGoogleSignIn(
        signInMethod.clientId,
        (idToken) => void reauthenticate(idToken),
        () => setReauth("pill"),
      );
    } else {
      setReauth("pill");
    }
  };
  useEffect(() => {
    startReauth.current = promptReauth;
  });

  // The pill: the fake backend needs no Google, so it signs in at once.
  const signInAgain = () =>
    signInMethod.kind === "fake"
      ? void reauthenticate(FAKE_ID_TOKEN)
      : promptReauth();

  const saveTask = async (save: TaskSave) => {
    const node = await writeTask(active, save, retryDelaysMs);
    // The task is saved. A failed reload must not show the save as failed.
    await refreshWithRetry().catch(() => undefined);
    return node;
  };

  /** Log time: the hand entries, then the data again (README "Log time"). */
  const logTime = async (entries: LogEntry[]) => {
    await writeLog(active, entries, retryDelaysMs);
    await refreshWithRetry().catch(() => undefined);
  };

  // The rings still to come. Any click or key press stops them.
  const ringing = useRef<Playing>(undefined);
  const stopRinging = () => {
    // The first click after a reload also lets the browser start audio.
    unlockAudio();
    ringing.current?.stop();
    ringing.current = undefined;
  };

  const ring = (event: BellEvent, cycle?: CyclePb) => {
    if (!data) return;
    ringing.current?.stop();
    const mode = cycle ? MODE_NAMES[cycle.mode as LoggedMode] : "Break";
    const task = cycle ? cycleContext(data, cycle).nodeName : "";
    ringing.current = ringBell(
      event,
      data.settings,
      loadLocalSettings(),
      {
        title: `${PRODUCT_NAME}: ${mode} cycle done`,
        body: task === "Inbox" || task === "" ? "Not sure yet" : task,
      },
      bell,
    );
  };

  const start = (nodeId: string, mode: LoggedMode, plannedMinutes: number) =>
    act(async () => {
      // START is a user gesture: the browser then lets the bell play later.
      unlockAudio();
      const request = {
        requestId: newRequestId(),
        nodeId: nodeId === INBOX_ID ? undefined : nodeId,
        mode,
        plannedMinutes,
      };
      const { cycle } = await withRetry(
        () => active.createCycle(request),
        retryDelaysMs,
      );
      if (cycle) {
        goHome();
        setScreen({ kind: "running", cycle });
      }
      await refreshWithRetry();
    });

  // A manual Stop and the end of the countdown can both call this. Only the
  // first one writes, so the app never writes minutes that were not worked.
  const writing = useRef(false);
  const writeMinutes = useCallback(
    async (
      cycle: CyclePb,
      minutes: number,
      onWritten: (written: CyclePb) => void,
    ) => {
      if (writing.current) return;
      writing.current = true;
      try {
        await act(async () => {
          const response = await withRetry(
            () =>
              active.updateCycle({
                cycleId: cycle.id,
                minutes,
                updateMask: { paths: ["minutes"] },
              }),
            retryDelaysMs,
          );
          if (loadExtension()?.cycleId === cycle.id) clearExtension();
          clearPause(cycle.id);
          if (response.cycle) onWritten(response.cycle);
          await refreshWithRetry();
        });
      } finally {
        writing.current = false;
      }
    },
    [act, active, refreshWithRetry, retryDelaysMs],
  );

  const showBell = (written: CyclePb) =>
    setScreen({ kind: "bell", cycle: written });
  // A manual Stop shows no bell. Start opens with the cycle's task and mode (README rule 11).
  const homeAfter = (cycle: CyclePb) => () => {
    setPreselectedNodeId(data && taskAfterCycle(data, cycle));
    setPreselectedMode(cycle.mode as LoggedMode);
    goHome();
    setScreen({ kind: "today" });
  };

  const runningCycle = screen.kind === "running" ? screen.cycle : undefined;
  const stop = (minutes: number, ranOut = false) => {
    if (!runningCycle || writing.current) return;
    if (ranOut) {
      ring("cycle", runningCycle);
      goHome();
    }
    void writeMinutes(
      runningCycle,
      minutes,
      ranOut ? showBell : homeAfter(runningCycle),
    );
  };

  const startExtension = (cycle: CyclePb, moreMinutes: number) => {
    const extension: PendingExtension = {
      cycleId: cycle.id,
      startedAtMs: Date.now(),
      minutes: moreMinutes,
      loggedMinutes: cycle.minutes ?? 0,
    };
    saveExtension(extension);
    setScreen({ kind: "extension", cycle, extension });
  };

  const extendedCycle = screen.kind === "extension" ? screen.cycle : undefined;
  const stopExtension = (totalMinutes: number, ranOut = false) => {
    if (!extendedCycle || writing.current) return;
    if (ranOut) {
      ring("cycle", extendedCycle);
      goHome();
    }
    const after = ranOut ? showBell : homeAfter(extendedCycle);
    if (totalMinutes > (extendedCycle.minutes ?? 0)) {
      void writeMinutes(extendedCycle, totalMinutes, after);
    } else {
      clearExtension();
      after(extendedCycle);
    }
  };

  /** Back to Start with the task and mode of the cycle before, as the bell shows them. */
  const backToStart = (nodeId: string | undefined, mode: LoggedMode) => {
    setPreselectedNodeId(nodeId);
    setPreselectedMode(mode);
    goHome();
    void showToday();
  };
  const breakAfterCycle = (loaded: TodayData, cycle: CyclePb) => {
    const { nodeName, path } = cycleContext(loaded, cycle);
    const mode = cycle.mode as LoggedMode;
    setScreen({
      kind: "break",
      comingBackTo: {
        mode,
        taskName: cycle.nodeId === undefined ? undefined : nodeName,
        path,
        nodeId: taskAfterCycle(loaded, cycle),
      },
      timer: firstBreakTimer(loaded),
    });
  };
  const breakFromStart = (
    loaded: TodayData,
    nodeId: string,
    mode: LoggedMode,
  ) => {
    const strip = taskStrip(loaded, nodeId);
    setScreen({
      kind: "break",
      comingBackTo: {
        mode,
        taskName: strip?.name,
        path: strip?.path ?? [],
        nodeId,
      },
      timer: firstBreakTimer(loaded),
    });
  };

  // A break starts short. Only the user picks the long break (README).
  const firstBreakTimer = (loaded: TodayData): BreakTimer =>
    breakTimerFor("short", loaded.settings.breakMinutes);

  // The timer store above the routes: one clock, the pause of each cycle, and
  // the time-out check, so that a cycle or break runs on while a page shows.
  // Each time-out fires once, from whatever page shows.
  const handledTimeOut = useRef<string>(undefined);
  const checkTimeOut = (at: Date) => {
    const timedOut = timeOutOf(screen, at);
    if (timedOut === undefined || handledTimeOut.current === timedOut) return;
    handledTimeOut.current = timedOut;
    if (screen.kind === "running") stop(screen.cycle.plannedMinutes, true);
    else if (screen.kind === "extension")
      stopExtension(
        screen.extension.loggedMinutes + screen.extension.minutes,
        true,
      );
    else if (screen.kind === "break") {
      ring("break");
      backToStart(screen.comingBackTo.nodeId, screen.comingBackTo.mode);
    }
  };
  const timeOutOf = (current: Screen, at: Date): string | undefined => {
    if (current.kind === "running") {
      const pause = pauseOf(current.cycle.id);
      return pause.sinceMs === undefined &&
        hasEnded(current.cycle, at, pausedMs(pause, at))
        ? `cycle:${current.cycle.id}`
        : undefined;
    }
    if (current.kind === "extension")
      return extensionRemainingMs(current.extension, at) === 0
        ? `extension:${current.cycle.id}:${current.extension.startedAtMs}`
        : undefined;
    if (current.kind === "break" && current.timer.startedAt !== undefined)
      return breakRemainingMs(current.timer, at) === 0
        ? `break:${current.timer.startedAt}`
        : undefined;
    return undefined;
  };
  const now = useClock(session ? 1000 : 60_000, checkTimeOut);
  const [pauses, setPauses] = useState<Record<string, PauseState>>({});
  const pauseOf = (cycleId: string): PauseState =>
    pauses[cycleId] ?? loadPause(cycleId) ?? { totalMs: 0 };
  // The stamps use the clock that the countdown shows. With Date.now(), the two
  // clocks can differ by up to a second, and the countdown then jumps by one.
  const togglePause = (cycleId: string) => {
    const at = now.getTime();
    const current = pauseOf(cycleId);
    const next =
      current.sinceMs === undefined
        ? { ...current, sinceMs: at }
        : { totalMs: current.totalMs + at - current.sinceMs };
    savePause(cycleId, next);
    setPauses((all) => ({ ...all, [cycleId]: next }));
  };

  const runningPause = runningCycle ? pauseOf(runningCycle.id) : undefined;
  const runningPaused =
    runningPause !== undefined && runningPause.sinceMs !== undefined;
  const runningEnded =
    runningCycle !== undefined &&
    runningPause !== undefined &&
    !runningPaused &&
    hasEnded(runningCycle, now, pausedMs(runningPause, now));
  const extensionLeft =
    screen.kind === "extension"
      ? extensionRemainingMs(screen.extension, now)
      : undefined;
  const breakLeft =
    screen.kind === "break" && screen.timer.startedAt !== undefined
      ? breakRemainingMs(screen.timer, now)
      : undefined;

  useFocusSound(
    (runningCycle !== undefined && !runningPaused && !runningEnded) ||
      (extensionLeft !== undefined && extensionLeft > 0),
    bell,
  );

  const timerChip = ((): TimerChip | undefined => {
    const onOpen = goHome;
    if (runningCycle && runningPause) {
      const mode = runningCycle.mode as LoggedMode;
      return {
        label: MODE_NAMES[mode],
        text: formatCountdown(
          remainingMs(runningCycle, now, pausedMs(runningPause, now)),
        ),
        modeKey: modeKey(mode),
        onOpen,
      };
    }
    if (screen.kind === "extension" && extensionLeft !== undefined) {
      const mode = screen.cycle.mode as LoggedMode;
      return {
        label: MODE_NAMES[mode],
        text: formatCountdown(extensionLeft),
        modeKey: modeKey(mode),
        onOpen,
      };
    }
    if (screen.kind === "break" && breakLeft !== undefined) {
      return {
        label: BREAK_NAMES[screen.timer.kind],
        text: formatCountdown(breakLeft),
        modeKey: "break",
        onOpen,
      };
    }
    return undefined;
  })();
  const pageSession =
    session && away
      ? { timer: timerChip, homeLabel: "back to the timer" }
      : undefined;

  const alert = error && (
    <p className="alert page-alert" role="alert">
      {error}
    </p>
  );
  const showPage = screen.kind === "today" || (session && away);
  const showSession = session && !away;

  return (
    <GuestContext.Provider
      value={mode === "guest" ? { onSignIn: openSignIn } : undefined}
    >
      <ReauthContext.Provider
        value={
          reauth === "pill"
            ? { onSignInAgain: signInAgain, onKeepGoing: keepGoing }
            : undefined
        }
      >
        <div
          className="app"
          onPointerDownCapture={stopRinging}
          onKeyDownCapture={stopRinging}
        >
          {screen.kind === "signIn" && (
            <SignInScreen
              method={signInMethod}
              busy={busy}
              error={error}
              onIdToken={signIn}
              onKeepGoing={keepGoing}
            />
          )}
          {screen.kind === "loading" && (
            <>
              <PageHeader framed />
              {alert}
              {error ? (
                <p className="page-alert">
                  <button
                    type="button"
                    className="button"
                    onClick={retryFirstLoad}
                  >
                    Try again
                  </button>
                </p>
              ) : reauth === "pill" ? (
                <p className="page-alert">
                  <button
                    type="button"
                    className="button"
                    disabled={busy}
                    onClick={signInAgain}
                  >
                    Sign in again
                  </button>{" "}
                  <button
                    type="button"
                    className="link-button"
                    onClick={keepGoing}
                  >
                    Keep going as a guest
                  </button>
                </p>
              ) : (
                <p className="note page-alert">Loading…</p>
              )}
            </>
          )}
          {screen.kind === "today" && data && view === "today" && (
            <>
              {alert}
              <StartScreen
                key={`${preselectedNodeId ?? "start"}-${preselectedMode ?? ""}`}
                data={data}
                timeZone={timeZone}
                busy={busy}
                initialNodeId={preselectedNodeId}
                initialMode={preselectedMode}
                onStart={(nodeId, mode, plannedMinutes) =>
                  void start(nodeId, mode, plannedMinutes)
                }
                onBreak={(nodeId, mode) => breakFromStart(data, nodeId, mode)}
                onSaveTask={saveTask}
                onOpenTasks={() => openView("tree")}
                onOpenSettings={openSettings}
                onOpenReport={() => openView("report")}
                onSignOut={signOut}
              />
            </>
          )}
          {showPage && data && view === "tree" && (
            <>
              {alert}
              <TasksPage
                client={active}
                data={data}
                timeZone={timeZone}
                retryDelaysMs={retryDelaysMs}
                onSaveTask={saveTask}
                onLogTime={logTime}
                openTaskId={address.taskId}
                onOpenTask={(taskId) => navigate({ view: "tree", taskId })}
                onUnknownTask={() => {
                  replaceAddress(HOME);
                  setAddress(HOME);
                }}
                onOpenStart={() => openView("today")}
                onOpenReport={() => openView("report")}
                onOpenSettings={openSettings}
                onSignOut={signOut}
                session={pageSession}
              />
            </>
          )}
          {showPage && data && view === "report" && (
            <>
              {alert}
              <ReportScreen
                client={active}
                email={data.email}
                timeZone={timeZone}
                retryDelaysMs={retryDelaysMs}
                onOpenStart={() => openView("today")}
                onOpenTasks={() => openView("tree")}
                onOpenSettings={openSettings}
                onSignOut={signOut}
                session={pageSession}
              />
            </>
          )}
          {showPage && data && view === "settings" && (
            <>
              {alert}
              <SettingsPage
                client={active}
                bell={bell}
                data={data}
                timeZone={timeZone}
                retryDelaysMs={retryDelaysMs}
                onSaved={() =>
                  void refreshWithRetry().catch((reason: unknown) =>
                    setError(String(reason)),
                  )
                }
                onOpenStart={() => openView("today")}
                onOpenTasks={() => openView("tree")}
                onOpenReport={() => openView("report")}
                onSignOut={signOut}
                session={pageSession}
              />
            </>
          )}
          {showSession && screen.kind === "running" && data && (
            <>
              {alert}
              <RunningScreen
                key={screen.cycle.id}
                cycle={screen.cycle}
                nodeName={cycleContext(data, screen.cycle).nodeName}
                path={cycleContext(data, screen.cycle).path}
                email={data.email}
                timeZone={timeZone}
                busy={busy}
                now={now}
                pause={pauseOf(screen.cycle.id)}
                onTogglePause={() => togglePause(screen.cycle.id)}
                onStop={(minutes) => stop(minutes)}
                onOpenTasks={() => openView("tree")}
                onOpenSettings={openSettings}
                onOpenReport={() => openView("report")}
                onSignOut={signOut}
              />
            </>
          )}
          {showSession && screen.kind === "bell" && data && (
            <>
              {alert}
              <BellScreen
                data={data}
                cycle={screen.cycle}
                timeZone={timeZone}
                busy={busy}
                onExtend={(moreMinutes) =>
                  startExtension(screen.cycle, moreMinutes)
                }
                onBreak={() => breakAfterCycle(data, screen.cycle)}
                onNewCycle={() =>
                  backToStart(
                    taskAfterCycle(data, screen.cycle),
                    screen.cycle.mode as LoggedMode,
                  )
                }
                onOpenTasks={() => openView("tree")}
                onOpenSettings={openSettings}
                onOpenReport={() => openView("report")}
                onSignOut={signOut}
              />
            </>
          )}
          {showSession && screen.kind === "extension" && data && (
            <>
              {alert}
              <ExtensionScreen
                key={`${screen.cycle.id}-${screen.extension.startedAtMs}`}
                cycle={screen.cycle}
                extension={screen.extension}
                nodeName={cycleContext(data, screen.cycle).nodeName}
                path={cycleContext(data, screen.cycle).path}
                email={data.email}
                timeZone={timeZone}
                busy={busy}
                now={now}
                onStop={(total) => stopExtension(total)}
                onOpenTasks={() => openView("tree")}
                onOpenSettings={openSettings}
                onOpenReport={() => openView("report")}
                onSignOut={signOut}
              />
            </>
          )}
          {showSession && screen.kind === "break" && data && (
            <BreakScreen
              comingBackTo={screen.comingBackTo}
              timer={screen.timer}
              breakMinutes={data.settings.breakMinutes}
              email={data.email}
              timeZone={timeZone}
              now={now}
              onTimerChange={(timer) => setScreen({ ...screen, timer })}
              onDone={() =>
                backToStart(
                  screen.comingBackTo.nodeId,
                  screen.comingBackTo.mode,
                )
              }
              onOpenTasks={() => openView("tree")}
              onOpenSettings={openSettings}
              onOpenReport={() => openView("report")}
              onSignOut={signOut}
            />
          )}
        </div>
      </ReauthContext.Provider>
    </GuestContext.Provider>
  );
}
