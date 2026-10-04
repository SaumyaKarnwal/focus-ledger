import { Code, ConnectError } from "@connectrpc/connect";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LedgerClient } from "./api/ledgerClient";
import { newRequestId } from "./api/requestId";
import { withRetry } from "./api/retry";
import {
  type BellDeps,
  type BellEvent,
  browserBell,
  ringBell,
  unlockAudio,
} from "./bell/bell";
import { longBreakDue } from "./bell/rhythm";
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
import { clearPause } from "./cycle/pauseStore";
import { RunningScreen } from "./cycle/RunningScreen";
import { FirstRunScreen } from "./firstRun/FirstRunScreen";
import type { CyclePb } from "./gen/focusledger/v1/model_pb";
import { browserTimeZone, formatHeaderTime } from "./ledger/period";
import type { LoggedMode } from "./ledger/rollup";
import { ReportScreen } from "./report/ReportScreen";
import { loadLocalSettings } from "./settings/localSettings";
import { SettingsPage } from "./settings/SettingsPage";
import { SignInScreen } from "./signIn/SignInScreen";
import type { SignInMethod } from "./signIn/signInMethod";
import { TasksPage } from "./tasks/TasksPage";
import { PageHeader } from "./ui/PageHeader";
import { useNow } from "./useNow";
import { loadToday } from "./today/loadToday";
import { PRODUCT_NAME } from "./productName";
import { taskStrip } from "./start/startModel";
import { type TaskSave, writeTask } from "./task/saveTask";
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
  | { kind: "break"; comingBackTo: ComingBackTo };

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

type View = "today" | "tree" | "report" | "settings";

const VIEWS: readonly [View, string][] = [
  ["today", "Today"],
  ["tree", "Tasks"],
  ["report", "Report"],
  ["settings", "Settings"],
];

type Props = {
  client: LedgerClient;
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
  timeZone = browserTimeZone(),
  retryDelaysMs,
  signInMethod = { kind: "fake" },
  bell = browserBell,
}: Props) {
  const [data, setData] = useState<TodayData>();
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    const loaded = await loadToday(client, new Date(), timeZone);
    setData(loaded);
    return loaded;
  }, [client, timeZone]);

  const act = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (reason) {
      // A session can end at any time, for example when the cookie expires.
      if (isUnauthenticated(reason)) setScreen({ kind: "signIn" });
      else setError(reason instanceof Error ? reason.message : String(reason));
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

  const [view, setView] = useState<View>("today");
  const openView = (next: View) => {
    setView(next);
    if (next === "today") void showToday();
    else {
      setPreselectedNodeId(undefined);
      setPreselectedMode(undefined);
    }
  };

  const openSettings = () => openView("settings");

  const [loadAttempt, setLoadAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    withRetry(
      () => loadToday(client, new Date(), timeZone),
      retryDelaysMs,
    ).then(
      (loaded) => {
        if (cancelled) return;
        setData(loaded);
        setScreen(screenFor(loaded));
      },
      (reason: unknown) => {
        if (cancelled) return;
        if (isUnauthenticated(reason)) setScreen({ kind: "signIn" });
        else setError(String(reason));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, timeZone, screenFor, retryDelaysMs, loadAttempt]);

  const signIn = (idToken: string) =>
    void act(async () => {
      await withRetry(
        () =>
          client.signIn({
            credential: { case: "googleIdToken", value: idToken },
          }),
        retryDelaysMs,
      );
      setScreen({ kind: "loading" });
      setView("today");
      setLoadAttempt((attempt) => attempt + 1);
    });

  const signOut = () =>
    void act(async () => {
      await withRetry(() => client.signOut({}), retryDelaysMs);
      setData(undefined);
      setScreen({ kind: "signIn" });
    });

  const retryFirstLoad = () => {
    setError(undefined);
    setLoadAttempt((attempt) => attempt + 1);
  };

  const refreshWithRetry = useCallback(
    () => withRetry(refresh, retryDelaysMs),
    [refresh, retryDelaysMs],
  );

  const saveTask = async (save: TaskSave) => {
    const node = await writeTask(client, save, retryDelaysMs);
    // The task is saved. A failed reload must not show the save as failed.
    await refreshWithRetry().catch(() => undefined);
    return node;
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
        () => client.createCycle(request),
        retryDelaysMs,
      );
      if (cycle) setScreen({ kind: "running", cycle });
      await refreshWithRetry();
    });

  // A manual Stop and the end of the countdown can both call this. Only the
  // first one writes, so the app never writes minutes that were not worked.
  const writing = useRef(false);
  const writeMinutes = useCallback(
    async (cycle: CyclePb, minutes: number) => {
      if (writing.current) return;
      writing.current = true;
      try {
        await act(async () => {
          const response = await withRetry(
            () =>
              client.updateCycle({
                cycleId: cycle.id,
                minutes,
                updateMask: { paths: ["minutes"] },
              }),
            retryDelaysMs,
          );
          if (loadExtension()?.cycleId === cycle.id) clearExtension();
          clearPause(cycle.id);
          if (response.cycle) {
            setScreen({ kind: "bell", cycle: response.cycle });
          }
          await refreshWithRetry();
        });
      } finally {
        writing.current = false;
      }
    },
    [act, client, refreshWithRetry, retryDelaysMs],
  );

  const runningCycle = screen.kind === "running" ? screen.cycle : undefined;
  const stop = (minutes: number, ranOut = false) => {
    if (!runningCycle) return;
    if (ranOut) ring("cycle", runningCycle);
    void writeMinutes(runningCycle, minutes);
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
    if (!extendedCycle) return;
    if (ranOut) ring("cycle", extendedCycle);
    if (totalMinutes > (extendedCycle.minutes ?? 0)) {
      void writeMinutes(extendedCycle, totalMinutes);
    } else {
      clearExtension();
      setScreen({ kind: "bell", cycle: extendedCycle });
    }
  };

  const [preselectedNodeId, setPreselectedNodeId] = useState<string>();
  const [preselectedMode, setPreselectedMode] = useState<LoggedMode>();
  /** Back to Start with the task and mode of the cycle before, as the bell shows them. */
  const backToStart = (nodeId: string | undefined, mode: LoggedMode) => {
    setPreselectedNodeId(nodeId);
    setPreselectedMode(mode);
    openView("today");
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
    });
  };

  const nav = (
    <nav className="nav" aria-label="Views">
      {VIEWS.map(([key, label]) => (
        <button
          key={key}
          type="button"
          aria-current={view === key ? "page" : undefined}
          onClick={() => (key === "settings" ? openSettings() : openView(key))}
        >
          {label}
        </button>
      ))}
    </nav>
  );
  const alert = error && (
    <p className="alert page-alert" role="alert">
      {error}
    </p>
  );
  const firstRun = screen.kind === "today" && data && isFirstRun(data);

  return (
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
        />
      )}
      {screen.kind === "loading" && (
        <>
          <PageHeader framed />
          {alert}
          {error ? (
            <p className="page-alert">
              <button type="button" className="button" onClick={retryFirstLoad}>
                Try again
              </button>
            </p>
          ) : (
            <p className="note page-alert">Loading…</p>
          )}
        </>
      )}
      {firstRun && (
        <>
          {alert}
          <FirstRunScreen
            client={client}
            settings={data.settings}
            retryDelaysMs={retryDelaysMs}
            onStarted={(cycle) => {
              setScreen({ kind: "running", cycle });
              void refreshWithRetry().catch((reason: unknown) =>
                setError(String(reason)),
              );
            }}
          />
        </>
      )}
      {!firstRun && screen.kind === "today" && data && view === "today" && (
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
            onSignOut={signOut}
          />
        </>
      )}
      {!firstRun && screen.kind === "today" && data && view === "tree" && (
        <>
          {alert}
          <TasksPage
            client={client}
            data={data}
            timeZone={timeZone}
            retryDelaysMs={retryDelaysMs}
            onSaveTask={saveTask}
            onOpenStart={() => openView("today")}
            onOpenReport={() => openView("report")}
            onOpenSettings={openSettings}
            onSignOut={signOut}
          />
        </>
      )}
      {!firstRun && screen.kind === "today" && data && view === "report" && (
        <>
          {alert}
          <ReportScreen
            client={client}
            timeZone={timeZone}
            retryDelaysMs={retryDelaysMs}
            nav={nav}
            headerEnd={<HeaderClock timeZone={timeZone} />}
          />
        </>
      )}
      {!firstRun && screen.kind === "today" && data && view === "settings" && (
        <>
          {alert}
          <SettingsPage
            client={client}
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
            onSignOut={signOut}
          />
        </>
      )}
      {screen.kind === "running" && data && (
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
            onStop={stop}
            bell={bell}
            onSignOut={signOut}
          />
        </>
      )}
      {screen.kind === "bell" && data && (
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
            onSignOut={signOut}
          />
        </>
      )}
      {screen.kind === "extension" && data && (
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
            onStop={stopExtension}
            bell={bell}
            onSignOut={signOut}
          />
        </>
      )}
      {screen.kind === "break" && data && (
        <BreakScreen
          comingBackTo={screen.comingBackTo}
          breakMinutes={data.settings.breakMinutes}
          email={data.email}
          timeZone={timeZone}
          initialKind={
            longBreakDue(
              data,
              new Date(),
              timeZone,
              loadLocalSettings().longBreakEvery,
            )
              ? "long"
              : "short"
          }
          onDone={(ranOut) => {
            if (ranOut) ring("break");
            backToStart(screen.comingBackTo.nodeId, screen.comingBackTo.mode);
          }}
          onSignOut={signOut}
        />
      )}
    </div>
  );
}

/** No node and no cycle yet: the first run (FR-1). */
function isFirstRun(data: TodayData): boolean {
  return data.allTimeNodes.every(
    (node) => node.id === INBOX_ID && node.cycles.length === 0,
  );
}

function HeaderClock({ timeZone }: { timeZone: string }) {
  const now = useNow(30_000);
  return <span className="topbar-meta">{formatHeaderTime(now, timeZone)}</span>;
}
