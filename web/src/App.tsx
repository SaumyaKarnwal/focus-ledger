import { Code, ConnectError } from "@connectrpc/connect";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LedgerClient } from "./api/ledgerClient";
import { newRequestId } from "./api/requestId";
import { withRetry } from "./api/retry";
import { BellScreen } from "./cycle/BellScreen";
import { BreakScreen } from "./cycle/BreakScreen";
import { ExtensionScreen } from "./cycle/ExtensionScreen";
import {
  clearExtension,
  loadExtension,
  type PendingExtension,
  saveExtension,
} from "./cycle/extensionStore";
import { clearPause } from "./cycle/pauseStore";
import { RunningScreen } from "./cycle/RunningScreen";
import { EntryDialog } from "./entry/EntryDialog";
import { FirstRunScreen } from "./firstRun/FirstRunScreen";
import type { CyclePb, NodePb } from "./gen/focusledger/v1/model_pb";
import { browserTimeZone, formatHeaderTime } from "./ledger/period";
import type { LoggedMode } from "./ledger/rollup";
import type { toEstimates } from "./tree/estimateModel";
import { ReportScreen } from "./report/ReportScreen";
import { SettingsScreen } from "./settings/SettingsScreen";
import { SignInScreen } from "./signIn/SignInScreen";
import type { SignInMethod } from "./signIn/signInMethod";
import { TreeScreen } from "./tree/TreeScreen";
import { PageHeader } from "./ui/PageHeader";
import { useNow } from "./useNow";
import { loadToday } from "./today/loadToday";
import { TodayScreen } from "./today/TodayScreen";
import {
  cycleContext,
  INBOX_ID,
  isClosedOrUnderClosed,
  knownCycles,
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
  | { kind: "break" };

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
  ["tree", "Tree"],
  ["report", "Report"],
  ["settings", "Settings"],
];

type Props = {
  client: LedgerClient;
  timeZone?: string;
  retryDelaysMs?: readonly number[];
  /** main.tsx passes Google for the real backend. The default suits the fake. */
  signInMethod?: SignInMethod;
};

function isUnauthenticated(reason: unknown): boolean {
  return ConnectError.from(reason).code === Code.Unauthenticated;
}

export function App({
  client,
  timeZone = browserTimeZone(),
  retryDelaysMs,
  signInMethod = { kind: "fake" },
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
  const [entryNodeId, setEntryNodeId] = useState<string>();
  const openView = (next: View) => {
    setView(next);
    setEntryNodeId(undefined);
    if (next === "today") void showToday();
    else setPreselectedNodeId(undefined);
  };

  // Settings returns to the page it was opened from, with the new settings loaded.
  const [returnView, setReturnView] = useState<View>("today");
  const openSettings = () => {
    if (view !== "settings") setReturnView(view);
    openView("settings");
  };
  const closeSettings = () => {
    if (returnView === "today") openView("today");
    else {
      void refreshWithRetry().catch((reason: unknown) =>
        setError(String(reason)),
      );
      openView(returnView);
    }
  };

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

  const start = (nodeId: string, mode: LoggedMode, plannedMinutes: number) =>
    act(async () => {
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
  const stop = useCallback(
    (minutes: number) => {
      if (runningCycle) void writeMinutes(runningCycle, minutes);
    },
    [runningCycle, writeMinutes],
  );

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
  const stopExtension = useCallback(
    (totalMinutes: number) => {
      if (!extendedCycle) return;
      if (totalMinutes > (extendedCycle.minutes ?? 0)) {
        void writeMinutes(extendedCycle, totalMinutes);
      } else {
        clearExtension();
        setScreen({ kind: "bell", cycle: extendedCycle });
      }
    },
    [extendedCycle, writeMinutes],
  );

  const saveEstimate = async (
    node: NodePb,
    estimates: ReturnType<typeof toEstimates>,
  ) => {
    let saved = false;
    await act(async () => {
      await withRetry(
        () =>
          client.updateNode({
            nodeId: node.id,
            estimates,
            updateMask: { paths: ["estimates"] },
          }),
        retryDelaysMs,
      );
      saved = true;
      await refreshWithRetry();
    });
    return saved;
  };

  // The Inbox is read again after a failure too, so a cycle that was filed
  // elsewhere leaves the list.
  const fileCycle = (cycle: CyclePb, nodeId: string) =>
    void act(async () => {
      try {
        await withRetry(
          () =>
            client.updateCycle({
              cycleId: cycle.id,
              nodeId,
              updateMask: { paths: ["node_id"] },
            }),
          retryDelaysMs,
        );
      } finally {
        await refreshWithRetry();
      }
    });

  const [preselectedNodeId, setPreselectedNodeId] = useState<string>();
  const openOnToday = (nodeId: string) => {
    setPreselectedNodeId(nodeId);
    openView("today");
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
    <div className="app">
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
          <PageHeader
            framed
            middle={nav}
            end={<HeaderClock timeZone={timeZone} />}
          />
          {alert}
          <TodayScreen
            key={preselectedNodeId ?? "today"}
            data={data}
            timeZone={timeZone}
            busy={busy}
            initialNodeId={preselectedNodeId}
            onStart={(nodeId, mode, plannedMinutes) =>
              void start(nodeId, mode, plannedMinutes)
            }
            onAddEntry={setEntryNodeId}
            onOpenTree={() => openView("tree")}
            onSaveEstimate={saveEstimate}
            onFile={fileCycle}
          />
        </>
      )}
      {!firstRun &&
        screen.kind === "today" &&
        data &&
        view === "today" &&
        entryNodeId !== undefined && (
          <EntryDialog
            client={client}
            settings={data.settings}
            nodes={data.allTimeNodes.filter(
              (node) =>
                node.id !== INBOX_ID &&
                !isClosedOrUnderClosed(node, data.allTimeNodes),
            )}
            initialNodeId={entryNodeId}
            timeZone={timeZone}
            retryDelaysMs={retryDelaysMs}
            onSaved={() => {
              setEntryNodeId(undefined);
              void showToday();
            }}
            onCancel={() => setEntryNodeId(undefined)}
          />
        )}
      {!firstRun && screen.kind === "today" && data && view === "tree" && (
        <>
          {alert}
          <TreeScreen
            client={client}
            settings={data.settings}
            timeZone={timeZone}
            retryDelaysMs={retryDelaysMs}
            nav={nav}
            onOpenOnToday={openOnToday}
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
          <SettingsScreen
            client={client}
            settings={data.settings}
            retryDelaysMs={retryDelaysMs}
            nav={nav}
            onDone={closeSettings}
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
            {...cycleContext(data, screen.cycle)}
            timeZone={timeZone}
            busy={busy}
            onStop={stop}
          />
        </>
      )}
      {screen.kind === "bell" && data && (
        <>
          {alert}
          <BellScreen
            cycle={screen.cycle}
            nodeName={cycleContext(data, screen.cycle).nodeName}
            path={cycleContext(data, screen.cycle).path}
            busy={busy}
            onExtend={(moreMinutes) =>
              startExtension(screen.cycle, moreMinutes)
            }
            onBreak={() => setScreen({ kind: "break" })}
            onNewCycle={() => void showToday()}
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
            timeZone={timeZone}
            busy={busy}
            onStop={stopExtension}
          />
        </>
      )}
      {screen.kind === "break" && data && (
        <BreakScreen
          breakMinutes={data.settings.breakMinutes}
          onDone={() => void showToday()}
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
