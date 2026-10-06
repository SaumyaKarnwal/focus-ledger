import { useEffect, useState } from "react";
import type { Ledger } from "../api/ledger";
import { withRetry } from "../api/retry";
import type { NodePb } from "../gen/focusledger/v1/model_pb";
import {
  localDateString,
  type TimeRange,
  toPeriodPb,
  weekRange,
} from "../ledger/period";
import { modeKey } from "../modes/modes";
import type { TimerChip } from "../session/sessionTimer";
import { ScreenHeader } from "../start/ScreenHeader";
import { formatMinutes, MODE_NAMES } from "../today/todayModel";
import { useNow } from "../useNow";
import { SplitRing } from "../ui/SplitRing";
import {
  changeLabel,
  cyclesIn,
  daysUpToNow,
  kindOfFocus,
  minutesByHour,
  minutesOf,
  peakLine,
  whereItWent,
} from "./reportCards";
import { FocusCurves } from "./FocusCurves";
import {
  BarsCard,
  FinishedCard,
  SetAndDoCard,
  YearCard,
} from "./ReportMoreCards";
import { barsByDay, barsByWeek, yearOf, yearSpan } from "./reportYear";
import {
  comparedSpans,
  type RangeChoice,
  type RangeKind,
  rangeOf,
  rangeTitle,
} from "./reportRange";

const KINDS: readonly [RangeKind, string][] = [
  ["today", "Today"],
  ["week", "Week"],
  ["month", "Month"],
  ["custom", "Custom"],
];

type Props = {
  client: Ledger;
  email: string;
  timeZone: string;
  retryDelaysMs?: readonly number[];
  onOpenStart: () => void;
  onOpenTasks: () => void;
  onOpenSettings: () => void;
  onSignOut: () => void;
  /** While a cycle or break runs: the chip, and the brand goes back to it. */
  session?: { timer?: TimerChip; homeLabel: string };
};

/** The Report (boards R-Report-*). A reading surface: nothing here can be edited (FR-11.5). */
export function ReportScreen({
  client,
  email,
  timeZone,
  retryDelaysMs,
  onOpenStart,
  onOpenTasks,
  onOpenSettings,
  onSignOut,
  session,
}: Props) {
  const now = useNow(60_000);
  const [choice, setChoice] = useState<RangeChoice>({ kind: "week", back: 0 });
  const range = rangeOf(choice, now, timeZone);
  const spans = comparedSpans(choice, now, timeZone);
  const barsSpan =
    choice.kind === "today" ? weekRange(range.start, timeZone) : range;
  const fetchStart = Math.min(
    spans.before.start.getTime(),
    barsSpan.start.getTime(),
  );
  const fetchEnd = Math.max(range.end.getTime(), barsSpan.end.getTime());
  const [loaded, setLoaded] = useState<{ key: string; nodes: NodePb[] }>();
  const [error, setError] = useState<string>();
  const key = `${fetchStart}-${fetchEnd}`;

  useEffect(() => {
    let cancelled = false;
    const period = toPeriodPb({
      start: new Date(fetchStart),
      end: new Date(fetchEnd),
    });
    withRetry(
      () => client.listNodes({ period, includeClosed: true }),
      retryDelaysMs,
    ).then(
      (response) => {
        if (cancelled) return;
        setLoaded({ key: `${fetchStart}-${fetchEnd}`, nodes: response.nodes });
        setError(undefined);
      },
      (reason: unknown) => {
        if (!cancelled) setError(String(reason));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, retryDelaysMs, fetchStart, fetchEnd]);

  const nodes = loaded?.key === key ? loaded.nodes : undefined;

  // Your year ignores the range above: it is always the last twelve months.
  const yearStart = yearSpan(now, timeZone).start.getTime();
  const [yearNodes, setYearNodes] = useState<NodePb[]>();
  useEffect(() => {
    let cancelled = false;
    const span = yearSpan(new Date(), timeZone);
    withRetry(
      () => client.listNodes({ period: toPeriodPb(span), includeClosed: true }),
      retryDelaysMs,
    ).then(
      (response) => {
        if (!cancelled) setYearNodes(response.nodes);
      },
      (reason: unknown) => {
        if (!cancelled) setError(String(reason));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, retryDelaysMs, timeZone, yearStart]);
  const current = nodes ? cyclesIn(nodes, spans.current) : [];
  const total = minutesOf(current);
  const change = nodes
    ? changeLabel(total, minutesOf(cyclesIn(nodes, spans.before)))
    : undefined;
  const title = rangeTitle(choice, now, timeZone);
  const atNow = choice.back === 0;
  const averaged = choice.kind !== "today";
  const days = averaged ? daysUpToNow(range, now, timeZone) : 1;
  const hours = minutesByHour(current, timeZone, days);

  const pick = (kind: RangeKind) =>
    setChoice({
      kind,
      back: 0,
      custom:
        kind === "custom"
          ? {
              from: localDateString(
                new Date(now.getTime() - 6 * 24 * 3600_000),
                timeZone,
              ),
              to: localDateString(now, timeZone),
            }
          : undefined,
    });

  return (
    <div className="tasks-page report-page" data-surface="page">
      <ScreenHeader
        now={now}
        timeZone={timeZone}
        email={email}
        current="report"
        onOpenHome={onOpenStart}
        onOpenTasks={onOpenTasks}
        onOpenReport={() => {}}
        onOpenSettings={onOpenSettings}
        onSignOut={onSignOut}
        timer={session?.timer}
        homeLabel={session?.homeLabel}
      />
      <main className="report-main">
        <div className="report-head">
          <div className="report-title">
            <div className="report-title-line">
              <span className="report-steps">
                <button
                  type="button"
                  className="report-step"
                  aria-label="Earlier"
                  onClick={() =>
                    setChoice({ ...choice, back: choice.back + 1 })
                  }
                >
                  <Chevron direction="left" />
                </button>
                <button
                  type="button"
                  className="report-step"
                  aria-label="Later"
                  disabled={atNow}
                  onClick={() =>
                    setChoice({ ...choice, back: choice.back - 1 })
                  }
                >
                  <Chevron direction="right" />
                </button>
              </span>
              <h1 className="report-heading">{title.title}</h1>
              <span className="report-dot" aria-hidden="true">
                ·
              </span>
              <span className="report-total" aria-label="Total">
                {nodes ? formatMinutes(total) : "—"}
              </span>
              {change && (
                <span
                  className="report-change"
                  data-sign={
                    change.startsWith("+")
                      ? "up"
                      : change.startsWith("−")
                        ? "down"
                        : "same"
                  }
                  aria-label={`Change against the range before: ${change}`}
                >
                  {change}
                </span>
              )}
            </div>
            <span className="report-dates">{title.dates}</span>
          </div>
          <div className="report-kinds" role="group" aria-label="Range">
            {KINDS.map(([kind, label]) => (
              <button
                key={kind}
                type="button"
                aria-pressed={choice.kind === kind}
                onClick={() => pick(kind)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {choice.kind === "custom" && choice.custom && (
          <div className="report-custom">
            <label>
              <span>From</span>
              <input
                type="date"
                value={choice.custom.from}
                max={choice.custom.to}
                onChange={(event) =>
                  event.target.value &&
                  setChoice({
                    kind: "custom",
                    back: 0,
                    custom: {
                      from: event.target.value,
                      to: choice.custom?.to ?? event.target.value,
                    },
                  })
                }
              />
            </label>
            <label>
              <span>To</span>
              <input
                type="date"
                value={choice.custom.to}
                min={choice.custom.from}
                onChange={(event) =>
                  event.target.value &&
                  setChoice({
                    kind: "custom",
                    back: 0,
                    custom: {
                      from: choice.custom?.from ?? event.target.value,
                      to: event.target.value,
                    },
                  })
                }
              />
            </label>
          </div>
        )}
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        <section
          className="task-card report-wide"
          aria-labelledby="report-when"
        >
          <div className="task-card-head">
            <h2 id="report-when" className="task-card-title">
              When you focus
            </h2>
            <ModeLegend />
          </div>
          {total === 0 ? (
            <p className="task-card-empty">No cycles in this range.</p>
          ) : (
            <>
              <p className="report-peak">{peakLine(hours, averaged)}</p>
              <FocusCurves hours={hours} />
            </>
          )}
        </section>
        <div className="report-row">
          <section className="task-card" aria-labelledby="report-kind">
            <div className="task-card-head">
              <h2 id="report-kind" className="task-card-title">
                Kind of focus
              </h2>
            </div>
            {total === 0 ? (
              <p className="task-card-empty">No cycles in this range.</p>
            ) : (
              <ul className="report-kind-list">
                {kindOfFocus(current).map((share) => (
                  <li key={share.mode} data-mode={modeKey(share.mode)}>
                    <span className="estimate-mode-bar" aria-hidden="true" />
                    <span className="report-kind-name">
                      {MODE_NAMES[share.mode]}
                    </span>
                    <span className="report-kind-minutes">
                      {formatMinutes(share.minutes)}
                    </span>
                    <span className="report-kind-percent">
                      {share.percent}%
                    </span>
                    <span className="report-kind-track" aria-hidden="true">
                      <span style={{ width: `${share.percent}%` }} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="task-card" aria-labelledby="report-where">
            <div className="task-card-head">
              <h2 id="report-where" className="task-card-title">
                Where it went
              </h2>
            </div>
            {total === 0 || !nodes ? (
              <p className="task-card-empty">No cycles in this range.</p>
            ) : (
              <WhereItWent nodes={nodes} current={current} />
            )}
          </section>
        </div>
        <div className="report-row report-row-three">
          <SetAndDoCard cycles={current} />
          <FinishedCard cycles={current} />
          {nodes && (
            <SmallBars
              choice={choice}
              nodes={nodes}
              span={barsSpan}
              now={now}
              timeZone={timeZone}
            />
          )}
        </div>
        {yearNodes && <YearCard year={yearOf(yearNodes, now, timeZone)} />}
      </main>
    </div>
  );
}

/** The third small card: This week so far, Your week, Week by week, or the days of a Custom span. */
function SmallBars({
  choice,
  nodes,
  span,
  now,
  timeZone,
}: {
  choice: RangeChoice;
  nodes: readonly NodePb[];
  span: TimeRange;
  now: Date;
  timeZone: string;
}) {
  const cycles = cyclesIn(nodes, span);
  const weekday = (day: Date) =>
    new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone }).format(
      day,
    );
  const dayOfMonth = (day: Date) =>
    new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone }).format(day);
  const days = Math.round(
    (span.end.getTime() - span.start.getTime()) / 86_400_000,
  );
  switch (choice.kind) {
    case "today":
      return (
        <BarsCard
          title="This week so far"
          bars={barsByDay(cycles, span, now, timeZone, weekday)}
        />
      );
    case "week":
      return (
        <BarsCard
          title="Your week"
          bars={barsByDay(cycles, span, now, timeZone, weekday)}
        />
      );
    case "month":
      return (
        <BarsCard
          title="Week by week"
          bars={barsByWeek(cycles, span, now, timeZone)}
        />
      );
    case "custom":
      return days <= 14 ? (
        <BarsCard
          title="Day by day"
          bars={barsByDay(cycles, span, now, timeZone, dayOfMonth)}
        />
      ) : (
        <BarsCard
          title="Week by week"
          bars={barsByWeek(cycles, span, now, timeZone)}
        />
      );
  }
}

function WhereItWent({
  nodes,
  current,
}: {
  nodes: readonly NodePb[];
  current: ReturnType<typeof cyclesIn>;
}) {
  const parts = whereItWent(nodes, current);
  return (
    <SplitRing
      parts={parts}
      label="Time split across your tasks"
      caption={`${parts.length} ${parts.length === 1 ? "task" : "tasks"}`}
      showModes
    />
  );
}

function ModeLegend() {
  return (
    <span className="report-legend">
      {Object.entries(MODE_NAMES).map(([mode, name]) => (
        <span
          key={mode}
          data-mode={modeKey(Number(mode) as keyof typeof MODE_NAMES)}
        >
          <span className="estimate-mode-bar" aria-hidden="true" />
          {name}
        </span>
      ))}
    </span>
  );
}

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={direction === "left" ? "M8.5 3L4.5 7l4 4" : "M5.5 3l4 4-4 4"} />
    </svg>
  );
}
