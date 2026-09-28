import { useState } from "react";
import { FocusMode } from "../gen/focusledger/v1/model_pb";
import { formatClockTime } from "../cycle/timer";
import {
  type ByMode,
  type CycleCounts,
  LOGGED_MODES,
  type LoggedMode,
  type Totals,
} from "../ledger/rollup";
import { cycleStart } from "../ledger/rollup";
import { useNow } from "../useNow";
import {
  formatMinutes,
  formatRelative,
  INBOX_ID,
  MODE_NAMES,
  plannedMinutesFor,
  selectedNode,
  type TodayData,
  todayModel,
} from "./todayModel";

const LENGTH_STEP = 5;
const LENGTH_MIN = 5;
const LENGTH_MAX = 1440;

type Props = {
  data: TodayData;
  timeZone: string;
  busy: boolean;
  onStart: (nodeId: string, mode: LoggedMode, plannedMinutes: number) => void;
  onAddEntry: (nodeId: string) => void;
  onOpenTree: () => void;
};

export function TodayScreen({
  data,
  timeZone,
  busy,
  onStart,
  onAddEntry,
  onOpenTree,
}: Props) {
  const now = useNow();
  const model = todayModel(data, now, timeZone);
  const [selectedId, setSelectedId] = useState(
    () => model.rail[0]?.nodeId ?? INBOX_ID,
  );
  const [mode, setMode] = useState<LoggedMode>(FocusMode.DEEP_FOCUS);
  const [plannedMinutes, setPlannedMinutes] = useState(() =>
    plannedMinutesFor(data.settings, FocusMode.DEEP_FOCUS),
  );
  const selected =
    selectedNode(data, selectedId, now, timeZone) ??
    selectedNode(data, INBOX_ID, now, timeZone);

  const chooseMode = (nextMode: LoggedMode) => {
    setMode(nextMode);
    setPlannedMinutes(plannedMinutesFor(data.settings, nextMode));
  };
  const stepLength = (step: number) =>
    setPlannedMinutes((minutes) =>
      Math.min(LENGTH_MAX, Math.max(LENGTH_MIN, minutes + step)),
    );

  const endsAt = new Date(now.getTime() + plannedMinutes * 60_000);
  const modeProgress = selected?.progress.byMode[mode];

  return (
    <>
      <section aria-labelledby="rail-heading">
        <h2 id="rail-heading">Open nodes</h2>
        <ul>
          <li>
            <button
              type="button"
              aria-pressed={selectedId === INBOX_ID}
              onClick={() => setSelectedId(INBOX_ID)}
            >
              Inbox
            </button>{" "}
            <span>{model.unfiledCycles} unfiled</span>
          </li>
          {model.rail.map((row) => (
            <li key={row.nodeId} data-testid="rail-row">
              <button
                type="button"
                aria-pressed={selectedId === row.nodeId}
                onClick={() => setSelectedId(row.nodeId)}
              >
                {row.name}
              </button>
              {row.path.length > 0 && <span> · {row.path.join(" › ")}</span>}
              <span>
                {" "}
                · {row.progress.doneCycles} of {row.progress.estimatedCycles}
              </span>
              <span>
                {" "}
                · {row.worked ? "worked" : "created"}{" "}
                {formatRelative(row.lastActivity, now)}
              </span>
              <Pips byMode={row.progress.byMode} />
            </li>
          ))}
        </ul>
        <p>
          Closed nodes are not listed.{" "}
          <button type="button" onClick={onOpenTree}>
            Open the Tree
          </button>{" "}
          to see them.
        </p>
      </section>

      <section aria-labelledby="selected-heading">
        {selected && selected.path.length > 0 && (
          <p aria-label="Breadcrumb">{selected.path.join(" › ")}</p>
        )}
        <h2 id="selected-heading">{selected?.name ?? "Inbox"}</h2>
        {selected && selected.nodeId !== INBOX_ID && (
          <p>
            {selected.progress.doneCycles} of{" "}
            {selected.progress.estimatedCycles} cycles
          </p>
        )}

        <fieldset>
          <legend>Mode</legend>
          {LOGGED_MODES.map((option) => (
            <label key={option}>
              <input
                type="radio"
                name="mode"
                checked={mode === option}
                onChange={() => chooseMode(option)}
              />
              {MODE_NAMES[option]}
            </label>
          ))}
        </fieldset>

        <p>
          <button
            type="button"
            aria-label="Shorter"
            onClick={() => stepLength(-LENGTH_STEP)}
          >
            −
          </button>{" "}
          <output aria-label="Length">{plannedMinutes} min</output>{" "}
          <button
            type="button"
            aria-label="Longer"
            onClick={() => stepLength(LENGTH_STEP)}
          >
            +
          </button>
        </p>

        <button
          type="button"
          disabled={busy}
          onClick={() =>
            onStart(selected?.nodeId ?? INBOX_ID, mode, plannedMinutes)
          }
        >
          Start
        </button>
        <p data-testid="meta-line">
          Ends at {formatClockTime(endsAt)} ·{" "}
          {selected?.nodeId === INBOX_ID || !modeProgress
            ? "goes to the Inbox"
            : modeProgress.estimatedCycles > 0
              ? `cycle ${modeProgress.doneCycles + 1} of ${modeProgress.estimatedCycles}`
              : "no estimate for this mode"}
        </p>

        <h3>
          Logged today{" "}
          <button
            type="button"
            onClick={() => onAddEntry(selected?.nodeId ?? INBOX_ID)}
          >
            + Add an entry
          </button>
        </h3>
        {selected && selected.loggedToday.length > 0 ? (
          <ul aria-label="Logged today">
            {selected.loggedToday.map((cycle) => (
              <li key={cycle.id}>
                {formatClockTime(cycleStart(cycle))} ·{" "}
                {MODE_NAMES[cycle.mode as LoggedMode]} · {cycle.minutes} min
              </li>
            ))}
          </ul>
        ) : (
          <p>Nothing logged today.</p>
        )}
      </section>

      <section aria-labelledby="glance-heading">
        <h2 id="glance-heading">At a glance</h2>
        <TotalsBlock title="Today" totals={model.todayTotals} />
        <TotalsBlock title="This week" totals={model.weekTotals} />
        <p>
          <a href="#report">Report</a>
        </p>
      </section>
    </>
  );
}

function TotalsBlock({ title, totals }: { title: string; totals: Totals }) {
  return (
    <div aria-label={title} role="group">
      <h3>
        {title}: {formatMinutes(totals.minutes)}
      </h3>
      <ul>
        {LOGGED_MODES.map((mode) => (
          <li key={mode}>
            {MODE_NAMES[mode]}: {formatMinutes(totals.minutesByMode[mode])}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Pips({ byMode }: { byMode: ByMode<CycleCounts> }) {
  const modes = LOGGED_MODES.filter(
    (mode) => byMode[mode].doneCycles > 0 || byMode[mode].estimatedCycles > 0,
  );
  return (
    <>
      {modes.map((mode) => {
        const { doneCycles, estimatedCycles } = byMode[mode];
        const over = Math.max(0, doneCycles - estimatedCycles);
        return (
          <span key={mode}>
            {" "}
            · {MODE_NAMES[mode]}{" "}
            {"●".repeat(Math.min(doneCycles, estimatedCycles))}
            {"○".repeat(Math.max(0, estimatedCycles - doneCycles))}
            {over > 0 && `|${"●".repeat(over)}`}
          </span>
        );
      })}
    </>
  );
}
