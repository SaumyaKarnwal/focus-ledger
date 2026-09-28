import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import type { LedgerClient } from "../api/ledgerClient";
import { withRetry } from "../api/retry";
import type { NodePb } from "../gen/focusledger/v1/model_pb";
import {
  dateSpanRange,
  formatShortDate,
  lastWeekRange,
  localDateString,
  monthRange,
  type TimeRange,
  toPeriodPb,
  weekRange,
} from "../ledger/period";
import { LOGGED_MODES, type Totals } from "../ledger/rollup";
import { modeKey } from "../modes/modes";
import { formatMinutes, MODE_NAMES } from "../today/todayModel";
import { PageHeader } from "../ui/PageHeader";
import {
  buildReport,
  type CrossTabRow,
  percentDifference,
  share,
} from "./reportModel";

export type PeriodChoice = "week" | "lastWeek" | "month" | "custom" | "all";

const PERIODS: readonly [PeriodChoice, string][] = [
  ["week", "This week"],
  ["lastWeek", "Last week"],
  ["month", "This month"],
  ["custom", "Custom"],
  ["all", "All"],
];

type Props = {
  client: LedgerClient;
  timeZone: string;
  retryDelaysMs?: readonly number[];
  nav: ReactNode;
  headerEnd: ReactNode;
};

/** A reading surface: nothing here can be edited (FR-11.5). */
export function ReportScreen({
  client,
  timeZone,
  retryDelaysMs,
  nav,
  headerEnd,
}: Props) {
  const [choice, setChoice] = useState<PeriodChoice>("week");
  const [from, setFrom] = useState(() => localDateString(new Date(), timeZone));
  const [to, setTo] = useState(() => localDateString(new Date(), timeZone));
  const range = rangeFor(choice, from, to, timeZone);
  const [nodes, setNodes] = useState<NodePb[]>();
  const [error, setError] = useState<string>();
  const startMs = range?.start.getTime();
  const endMs = range?.end.getTime();

  useEffect(() => {
    let cancelled = false;
    const period =
      startMs === undefined || endMs === undefined
        ? undefined
        : toPeriodPb({ start: new Date(startMs), end: new Date(endMs) });
    withRetry(
      () => client.listNodes({ period, includeClosed: true }),
      retryDelaysMs,
    ).then(
      (response) => {
        if (cancelled) return;
        setNodes(response.nodes);
        setError(undefined);
      },
      (reason: unknown) => {
        if (!cancelled) setError(String(reason));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, retryDelaysMs, startMs, endMs]);

  const report = nodes && buildReport(nodes);

  return (
    <>
      <PageHeader framed middle={nav} end={headerEnd} />
      <div className="report">
        <div className="report-head">
          <div className="report-title">
            <h2 className="title report-heading">
              {PERIODS.find(([key]) => key === choice)?.[1]}
            </h2>
            <span className="muted">
              {range ? rangeLabel(range, timeZone) : "All time"}
              {report && ` · ${report.loggedCycles} cycles`}
            </span>
          </div>
          <div className="report-controls">
            {choice === "custom" && (
              <span className="report-dates">
                <label className="field">
                  <span className="label">From</span>
                  <input
                    className="text-input"
                    type="date"
                    value={from}
                    max={to}
                    onChange={(event) => setFrom(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span className="label">To</span>
                  <input
                    className="text-input"
                    type="date"
                    value={to}
                    min={from}
                    onChange={(event) => setTo(event.target.value)}
                  />
                </label>
              </span>
            )}
            <div className="segmented" role="group" aria-label="Period">
              {PERIODS.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={choice === key}
                  onClick={() => setChoice(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        {report && (
          <>
            <div className="report-grid">
              <section className="report-block" aria-labelledby="by-mode">
                <h3 id="by-mode" className="label report-block-head">
                  By mode
                </h3>
                <p className="report-total mono">
                  {formatMinutes(report.grand.minutes)}
                </p>
                <ul className="mode-bars">
                  {LOGGED_MODES.map((mode) => (
                    <li key={mode} data-mode={modeKey(mode)}>
                      <span className="mode-bars-head">
                        <span className="mode-row-name">
                          {MODE_NAMES[mode]}
                        </span>
                        <span className="mono">
                          {formatMinutes(report.grand.minutesByMode[mode])} ·{" "}
                          {share(
                            report.grand.minutesByMode[mode],
                            report.grand.minutes,
                          )}
                        </span>
                      </span>
                      <span className="mode-bars-track" aria-hidden="true">
                        <span
                          style={{
                            width: share(
                              report.grand.minutesByMode[mode],
                              report.grand.minutes,
                            ),
                          }}
                        />
                      </span>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="report-block" aria-labelledby="estimated">
                <h3 id="estimated" className="label report-block-head">
                  Estimated against actual
                </h3>
                {report.estimates.length === 0 ? (
                  <p className="note">
                    No node with an estimate has cycles here.
                  </p>
                ) : (
                  <table className="report-table" aria-labelledby="estimated">
                    <thead>
                      <tr>
                        <th scope="col">Node</th>
                        <th scope="col">Est</th>
                        <th scope="col">Done</th>
                        <th scope="col">Diff</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.estimates.map((row) => (
                        <tr key={row.nodeId}>
                          <th scope="row">
                            {row.path.length > 0 && (
                              <span className="muted">
                                {row.path.join(" / ")} /{" "}
                              </span>
                            )}
                            {row.name}
                          </th>
                          <td>{row.estimatedCycles}</td>
                          <td>{row.doneCycles}</td>
                          <td className="strong">
                            {percentDifference(
                              row.estimatedCycles,
                              row.doneCycles,
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <p className="note">
                  Cycles logged on each node itself in this period, against its
                  own estimate.
                </p>
              </section>

              <section className="report-block" aria-labelledby="planned">
                <h3 id="planned" className="label report-block-head">
                  Planned against actual
                </h3>
                <table className="report-table" aria-labelledby="planned">
                  <thead>
                    <tr>
                      <th scope="col">Mode</th>
                      <th scope="col">Cycles</th>
                      <th scope="col">Planned</th>
                      <th scope="col">Actual</th>
                      <th scope="col">Diff</th>
                    </tr>
                  </thead>
                  <tbody>
                    {LOGGED_MODES.map((mode) => {
                      const row = report.plannedVsActual[mode];
                      return (
                        <tr key={mode}>
                          <th scope="row">{MODE_NAMES[mode]}</th>
                          <td>{row.doneCycles}</td>
                          <td>{formatMinutes(row.plannedMinutes)}</td>
                          <td>{formatMinutes(row.minutes)}</td>
                          <td className="strong">
                            {percentDifference(
                              row.plannedMinutes,
                              row.minutes,
                            ) ?? "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="note">
                  The length chosen at Start against the minutes logged.
                </p>
              </section>
            </div>

            <CrossTab report={report} />

            <p className="report-foot note">
              Closed nodes are included. A moved node counts under its new
              parent for every period.
            </p>
          </>
        )}
      </div>
    </>
  );
}

function CrossTab({ report }: { report: ReturnType<typeof buildReport> }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (nodeId: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  const visible = (rows: readonly CrossTabRow[]): CrossTabRow[] =>
    rows.flatMap((row) => [
      row,
      ...(open.has(row.nodeId) ? visible(row.children) : []),
    ]);

  return (
    <section className="crosstab" aria-labelledby="crosstab-heading">
      <div className="crosstab-head">
        <h3 id="crosstab-heading" className="title crosstab-title">
          Node × mode
        </h3>
        <span className="note">Minutes. Rows roll up their children.</span>
      </div>
      <table
        className="report-table crosstab-table"
        aria-labelledby="crosstab-heading"
      >
        <thead>
          <tr>
            <th scope="col">Node</th>
            {LOGGED_MODES.map((mode) => (
              <th key={mode} scope="col" data-mode={modeKey(mode)}>
                <span className="crosstab-bar" aria-hidden="true" />
                {MODE_NAMES[mode]}
              </th>
            ))}
            <th scope="col">Total</th>
            <th scope="col">Share</th>
          </tr>
        </thead>
        <tbody>
          {visible(report.rows).map((row) => (
            <CrossTabLine
              key={row.nodeId}
              label={
                <span
                  className="crosstab-node"
                  style={{ "--depth": row.depth } as CSSProperties}
                >
                  {row.children.length > 0 ? (
                    <button
                      type="button"
                      className="crosstab-toggle"
                      aria-expanded={open.has(row.nodeId)}
                      onClick={() => toggle(row.nodeId)}
                    >
                      {row.name}
                    </button>
                  ) : (
                    row.name
                  )}
                  {row.closed && <span className="hint"> closed</span>}
                </span>
              }
              totals={row.totals}
              grand={report.grand.minutes}
            />
          ))}
          <CrossTabLine
            label="Inbox"
            totals={report.inbox}
            grand={report.grand.minutes}
          />
          <CrossTabLine
            label="All"
            totals={report.grand}
            grand={report.grand.minutes}
            strong
          />
        </tbody>
      </table>
    </section>
  );
}

function CrossTabLine({
  label,
  totals,
  grand,
  strong = false,
}: {
  label: ReactNode;
  totals: Totals;
  grand: number;
  strong?: boolean;
}) {
  return (
    <tr className={strong ? "crosstab-total" : undefined}>
      <th scope="row">{label}</th>
      {LOGGED_MODES.map((mode) => (
        <td key={mode} data-empty={totals.minutesByMode[mode] === 0}>
          {totals.minutesByMode[mode] === 0 ? "—" : totals.minutesByMode[mode]}
        </td>
      ))}
      <td>{totals.minutes}</td>
      <td className="muted">{share(totals.minutes, grand)}</td>
    </tr>
  );
}

function rangeFor(
  choice: PeriodChoice,
  from: string,
  to: string,
  timeZone: string,
): TimeRange | undefined {
  const now = new Date();
  switch (choice) {
    case "week":
      return weekRange(now, timeZone);
    case "lastWeek":
      return lastWeekRange(now, timeZone);
    case "month":
      return monthRange(now, timeZone);
    case "custom":
      return dateSpanRange(
        from <= to ? from : to,
        from <= to ? to : from,
        timeZone,
      );
    case "all":
      return undefined;
  }
}

/** "26 Oct – 1 Nov", from the first to the last local day of the range. */
function rangeLabel(range: TimeRange, timeZone: string): string {
  const lastDay = new Date(range.end.getTime() - 1);
  return `${formatShortDate(range.start, timeZone)} – ${formatShortDate(lastDay, timeZone)}`;
}
