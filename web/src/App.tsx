import { useCallback, useEffect, useState } from "react";
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
import { RunningScreen } from "./cycle/RunningScreen";
import type { CyclePb } from "./gen/focusledger/v1/model_pb";
import { browserTimeZone } from "./ledger/period";
import type { LoggedMode } from "./ledger/rollup";
import { PRODUCT_NAME } from "./productName";
import { loadToday } from "./today/loadToday";
import { TodayScreen } from "./today/TodayScreen";
import {
  cycleContext,
  INBOX_ID,
  type TodayData,
  todayModel,
} from "./today/todayModel";

type Screen =
  | { kind: "loading" }
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
  const cycle = loaded.allTimeNodes
    .flatMap((node) => node.cycles)
    .find((listed) => listed.id === extension.cycleId);
  if (cycle?.minutes !== extension.loggedMinutes) {
    clearExtension();
    return undefined;
  }
  return { cycle, extension };
}

type Props = {
  client: LedgerClient;
  timeZone?: string;
  retryDelaysMs?: readonly number[];
};

export function App({
  client,
  timeZone = browserTimeZone(),
  retryDelaysMs,
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
      setError(reason instanceof Error ? reason.message : String(reason));
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
      setScreen(screenFor(await refresh()));
    });

  useEffect(() => {
    let cancelled = false;
    loadToday(client, new Date(), timeZone).then(
      (loaded) => {
        if (cancelled) return;
        setData(loaded);
        setScreen(screenFor(loaded));
      },
      (reason: unknown) => {
        if (!cancelled) setError(String(reason));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, timeZone, screenFor]);

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
      await refresh();
      if (cycle) setScreen({ kind: "running", cycle });
    });

  const writeMinutes = useCallback(
    (cycle: CyclePb, minutes: number) =>
      act(async () => {
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
        await refresh();
        if (response.cycle) setScreen({ kind: "bell", cycle: response.cycle });
      }),
    [act, client, refresh, retryDelaysMs],
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

  return (
    <main>
      <h1>{PRODUCT_NAME}</h1>
      {error && <p role="alert">{error}</p>}
      {screen.kind === "loading" && <p>Loading…</p>}
      {screen.kind === "today" && data && (
        <TodayScreen
          data={data}
          timeZone={timeZone}
          busy={busy}
          onStart={(nodeId, mode, plannedMinutes) =>
            void start(nodeId, mode, plannedMinutes)
          }
        />
      )}
      {screen.kind === "running" && data && (
        <RunningScreen
          key={screen.cycle.id}
          cycle={screen.cycle}
          {...cycleContext(data, screen.cycle)}
          busy={busy}
          onStop={stop}
        />
      )}
      {screen.kind === "bell" && data && (
        <BellScreen
          cycle={screen.cycle}
          nodeName={cycleContext(data, screen.cycle).nodeName}
          busy={busy}
          onExtend={(moreMinutes) => startExtension(screen.cycle, moreMinutes)}
          onBreak={() => setScreen({ kind: "break" })}
          onNewCycle={() => void showToday()}
        />
      )}
      {screen.kind === "extension" && data && (
        <ExtensionScreen
          key={`${screen.cycle.id}-${screen.extension.startedAtMs}`}
          cycle={screen.cycle}
          extension={screen.extension}
          nodeName={cycleContext(data, screen.cycle).nodeName}
          busy={busy}
          onStop={stopExtension}
        />
      )}
      {screen.kind === "break" && data && (
        <BreakScreen
          breakMinutes={data.settings.breakMinutes}
          onDone={() => void showToday()}
        />
      )}
    </main>
  );
}
