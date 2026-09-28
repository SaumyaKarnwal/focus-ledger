import { useState } from "react";
import {
  type CyclePb,
  FocusMode,
  type NodePb,
} from "../gen/focusledger/v1/model_pb";
import { formatSince, localTimeString } from "../ledger/period";
import {
  type ByMode,
  cycleStart,
  LOGGED_MODES,
  type LoggedMode,
  type Totals,
} from "../ledger/rollup";
import { ModeRows } from "../modes/ModeRows";
import { modeKey } from "../modes/modes";
import { InboxList } from "../inbox/InboxList";
import {
  type EstimateRow,
  estimateRows,
  estimateSummary,
  toEstimates,
} from "../tree/estimateModel";
import { Pips } from "../ui/Pips";
import { useNow } from "../useNow";
import {
  formatMinutes,
  INBOX_ID,
  isClosedOrUnderClosed,
  MODE_NAMES,
  nextCycleLine,
  plannedMinutesFor,
  type RailRow,
  selectedNode,
  type TodayData,
  todayModel,
  todaySentence,
} from "./todayModel";

const LENGTH_STEP = 5;
const LENGTH_MIN = 5;
const LENGTH_MAX = 1440;

type Props = {
  data: TodayData;
  timeZone: string;
  busy: boolean;
  /** The node to select first, for example from "Open on Today" in the Tree. */
  initialNodeId?: string;
  onStart: (nodeId: string, mode: LoggedMode, plannedMinutes: number) => void;
  onAddEntry: (nodeId: string) => void;
  onOpenTree: () => void;
  onSaveEstimate: (
    node: NodePb,
    estimates: ReturnType<typeof toEstimates>,
  ) => Promise<boolean>;
  onFile: (cycle: CyclePb, nodeId: string) => void;
};

export function TodayScreen({
  data,
  timeZone,
  busy,
  initialNodeId,
  onStart,
  onAddEntry,
  onOpenTree,
  onSaveEstimate,
  onFile,
}: Props) {
  const now = useNow();
  const model = todayModel(data, now, timeZone);
  const [selectedId, setSelectedId] = useState(
    () => initialNodeId ?? model.rail[0]?.nodeId ?? INBOX_ID,
  );
  const [mode, setMode] = useState<LoggedMode>(FocusMode.DEEP_FOCUS);
  const [plannedMinutes, setPlannedMinutes] = useState(() =>
    plannedMinutesFor(data.settings, FocusMode.DEEP_FOCUS),
  );
  const [editing, setEditing] = useState<ByMode<EstimateRow>>();

  const selected =
    selectedNode(data, selectedId, now, timeZone) ??
    selectedNode(data, INBOX_ID, now, timeZone);
  const isInboxSelected = !selected || selected.nodeId === INBOX_ID;

  const choose = (nodeId: string) => {
    setSelectedId(nodeId);
    setEditing(undefined);
  };
  const chooseMode = (nextMode: LoggedMode) => {
    setMode(nextMode);
    setPlannedMinutes(plannedMinutesFor(data.settings, nextMode));
  };
  const stepLength = (step: number) =>
    setPlannedMinutes((minutes) =>
      Math.min(LENGTH_MAX, Math.max(LENGTH_MIN, minutes + step)),
    );
  const saveEstimate = async () => {
    if (!selected || !editing) return;
    if (await onSaveEstimate(selected.node, toEstimates(editing))) {
      setEditing(undefined);
    }
  };

  const endsAt = new Date(now.getTime() + plannedMinutes * 60_000);
  const nodeId = selected?.nodeId ?? INBOX_ID;
  const fileTargets = data.allTimeNodes.filter(
    (node) =>
      node.id !== INBOX_ID && !isClosedOrUnderClosed(node, data.allTimeNodes),
  );

  return (
    <div className="today">
      <aside className="rail" aria-labelledby="rail-heading">
        <div className="rail-head">
          <h2 id="rail-heading" className="label">
            Ongoing
          </h2>
          <span className="label">recent first</span>
        </div>
        <ul className="rail-list" aria-label="Open nodes">
          {model.rail.map((row) => (
            <li key={row.nodeId} data-testid="rail-row">
              <RailButton
                row={row}
                now={now}
                timeZone={timeZone}
                pressed={selectedId === row.nodeId}
                onSelect={() => choose(row.nodeId)}
              />
            </li>
          ))}
          <li>
            <button
              type="button"
              className="rail-row"
              aria-pressed={isInboxSelected}
              onClick={() => choose(INBOX_ID)}
            >
              <span className="rail-row-top">
                <span className="rail-row-names">
                  <span className="rail-row-name" data-part="name">
                    Inbox
                  </span>
                  <span className="rail-row-path">
                    No task · re-file later, or never
                  </span>
                </span>
                <span className="rail-row-figures">
                  <span className="rail-row-count" data-estimated="false">
                    {model.unfiledCycles} unfiled
                  </span>
                  {model.inbox.lastActivity && (
                    <span className="rail-row-time">
                      {formatSince(model.inbox.lastActivity, now, timeZone)}
                    </span>
                  )}
                </span>
              </span>
              <Pips modes={model.inbox.cycleModes} estimated={0} />
            </button>
          </li>
        </ul>
        <button
          type="button"
          className="link-button rail-pull"
          onClick={onOpenTree}
        >
          + Pull a node in from the tree
        </button>
        <div className="rail-foot">
          <p>Open nodes only, most recently worked first.</p>
          <p>
            Close one in the{" "}
            <button type="button" className="link-button" onClick={onOpenTree}>
              Tree
            </button>{" "}
            and it leaves this list without losing its cycles.
          </p>
        </div>
      </aside>

      <section className="centre" aria-labelledby="selected-heading">
        <div className="centre-title">
          {selected && selected.path.length > 0 && (
            <span className="crumb" aria-label="Breadcrumb">
              {selected.path.join(" / ")}
            </span>
          )}
          <h2 id="selected-heading" className="title title-xl">
            {selected?.name ?? "Inbox"}
          </h2>
        </div>

        {isInboxSelected ? (
          <div className="estimate-panel">
            <div className="section-head">
              <h3 className="label">Mode</h3>
            </div>
            <ModeRows
              selected={mode}
              onSelect={chooseMode}
              groupName="today-mode"
            />
          </div>
        ) : editing ? (
          <div className="estimate-panel" data-editing="true">
            <div className="section-head">
              <h3 className="label">Estimate · editing</h3>
              <span className="estimate-panel-actions">
                <button
                  type="button"
                  className="button button-small"
                  onClick={() => setEditing(undefined)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="button-primary button-small"
                  disabled={busy}
                  onClick={() => void saveEstimate()}
                >
                  Save
                </button>
              </span>
            </div>
            <ModeRows estimate={{ rows: editing, onChange: setEditing }} />
            <EstimateSummaryLine rows={editing} />
          </div>
        ) : (
          <div className="estimate-panel">
            <div className="section-head">
              <h3 className="label">
                Estimate · {selected?.progress.doneCycles} of{" "}
                {selected?.progress.estimatedCycles} cycles done
              </h3>
              {selected && (
                <button
                  type="button"
                  className="link-button"
                  onClick={() =>
                    setEditing(estimateRows(selected.node, data.settings))
                  }
                >
                  Edit estimate
                </button>
              )}
            </div>
            <ModeRows
              selected={mode}
              onSelect={chooseMode}
              groupName="today-mode"
              progress={selected?.modeProgress}
            />
          </div>
        )}

        {isInboxSelected && (
          <div className="estimate-panel">
            <div className="section-head">
              <h3 className="label">Unfiled</h3>
            </div>
            <InboxList
              cycles={model.inbox.cycles}
              targets={fileTargets}
              timeZone={timeZone}
              busy={busy}
              onFile={onFile}
            />
          </div>
        )}

        <div className="start-row" aria-hidden={editing ? true : undefined}>
          <div className="length-stepper">
            <button
              type="button"
              className="icon-button"
              aria-label="Five minutes less"
              tabIndex={editing ? -1 : undefined}
              disabled={editing !== undefined}
              onClick={() => stepLength(-LENGTH_STEP)}
            >
              −
            </button>
            <span className="length-value">
              <output aria-label="Length">{plannedMinutes}</output>
              <span className="stepper-unit">min</span>
            </span>
            <button
              type="button"
              className="icon-button"
              aria-label="Five minutes more"
              tabIndex={editing ? -1 : undefined}
              disabled={editing !== undefined}
              onClick={() => stepLength(LENGTH_STEP)}
            >
              +
            </button>
          </div>
          <button
            type="button"
            className="button-primary start-button"
            tabIndex={editing ? -1 : undefined}
            disabled={busy || editing !== undefined}
            onClick={() => onStart(nodeId, mode, plannedMinutes)}
          >
            Start
          </button>
        </div>

        {editing ? (
          <p className="held-line">
            <LockIcon />
            Starting is held while you change the plan. Save or cancel to get it
            back.
          </p>
        ) : (
          <p className="meta-line" data-testid="meta-line">
            <span>Pick a row, set the length, start</span>
            <span>Ends at {localTimeString(endsAt, timeZone)}</span>
            <span>
              {nextCycleLine(selected?.modeProgress[mode], isInboxSelected)}
            </span>
            <span>
              <button
                type="button"
                className="link-button"
                onClick={() => onAddEntry(nodeId)}
              >
                Log it without the timer
              </button>
            </span>
          </p>
        )}

        <div className="logged">
          <div className="section-head">
            <h3 className="label">Logged today</h3>
            <button
              type="button"
              className="link-button"
              onClick={() => onAddEntry(nodeId)}
            >
              + Add an entry
            </button>
          </div>
          {selected && selected.loggedToday.length > 0 ? (
            <ul className="cycle-list" aria-label="Logged today">
              {selected.loggedToday.map((cycle) => (
                <li
                  key={cycle.id}
                  className="cycle-row"
                  data-mode={modeKey(cycle.mode)}
                >
                  <span className="mode-bar" aria-hidden="true" />
                  <span className="cycle-row-name">{selected.name}</span>
                  <span className="cycle-row-mode">
                    {MODE_NAMES[cycle.mode as LoggedMode]}
                  </span>
                  <span className="cycle-row-time">
                    {localTimeString(cycleStart(cycle), timeZone)}
                  </span>
                  <span className="cycle-row-minutes">{cycle.minutes}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="note">Nothing logged today.</p>
          )}
        </div>
      </section>

      <aside className="glance" aria-label="At a glance">
        <section className="glance-block" aria-label="Today">
          <div className="glance-head">
            <h3 className="label">Today</h3>
            <span className="note">{model.todayModes.length} cycles</span>
          </div>
          <p className="glance-total" data-testid="total">
            {formatMinutes(model.todayTotals.minutes)}
          </p>
          <SplitBar totals={model.todayTotals} />
          <p className="note">{todaySentence(model.todayModes)}</p>
        </section>
        <section className="glance-block" aria-label="This week">
          <div className="glance-head">
            <h3 className="label">This week</h3>
            <span className="mono" data-testid="total">
              {formatMinutes(model.weekTotals.minutes)}
            </span>
          </div>
          <ShareRows totals={model.weekTotals} />
        </section>
        <p className="glance-foot">{model.allTimeCycles} cycles logged</p>
      </aside>
    </div>
  );
}

function RailButton({
  row,
  now,
  timeZone,
  pressed,
  onSelect,
}: {
  row: RailRow;
  now: Date;
  timeZone: string;
  pressed: boolean;
  onSelect: () => void;
}) {
  const { doneCycles, estimatedCycles } = row.progress;
  return (
    <button
      type="button"
      className="rail-row"
      aria-pressed={pressed}
      onClick={onSelect}
    >
      <span className="rail-row-top">
        <span className="rail-row-names">
          <span className="rail-row-name" data-part="name">
            {row.name}
          </span>
          {row.path.length > 0 && (
            <span className="rail-row-path">{row.path.join(" / ")}</span>
          )}
        </span>
        <span className="rail-row-figures">
          <span className="rail-row-count" data-estimated={estimatedCycles > 0}>
            {estimatedCycles > 0
              ? `${doneCycles} of ${estimatedCycles}`
              : `${doneCycles} · no est.`}
          </span>
          <span className="rail-row-time">
            {row.worked ? "" : "created "}
            {formatSince(row.lastActivity, now, timeZone)}
          </span>
        </span>
      </span>
      <Pips modes={row.cycleModes} estimated={estimatedCycles} />
    </button>
  );
}

function EstimateSummaryLine({ rows }: { rows: ByMode<EstimateRow> }) {
  const summary = estimateSummary(rows);
  return (
    <div className="estimate-summary">
      <span className="note">
        Changing an estimate never touches a cycle already written.
      </span>
      <span className="mono" aria-label="Estimate summary">
        {summary.cycles} cycles · {formatMinutes(summary.minutes)}
      </span>
    </div>
  );
}

function SplitBar({ totals }: { totals: Totals }) {
  const label = LOGGED_MODES.map(
    (mode) =>
      `${MODE_NAMES[mode]} ${formatMinutes(totals.minutesByMode[mode])}`,
  ).join(", ");
  return (
    <div className="split-bar" role="img" aria-label={label}>
      {totals.minutes > 0 &&
        LOGGED_MODES.map((mode) => (
          <span
            key={mode}
            data-mode={modeKey(mode)}
            style={{
              width: `${(totals.minutesByMode[mode] / totals.minutes) * 100}%`,
            }}
          />
        ))}
    </div>
  );
}

function ShareRows({ totals }: { totals: Totals }) {
  return (
    <ul className="share-rows">
      {LOGGED_MODES.map((mode) => {
        const share =
          totals.minutes > 0
            ? Math.round((totals.minutesByMode[mode] / totals.minutes) * 100)
            : 0;
        return (
          <li key={mode} className="share-row" data-mode={modeKey(mode)}>
            <span className="share-row-name">{MODE_NAMES[mode]}</span>
            <span className="share-row-track" aria-hidden="true">
              <span style={{ width: `${share}%` }} />
            </span>
            <span
              className="share-row-value"
              title={formatMinutes(totals.minutesByMode[mode])}
            >
              {share}%
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function LockIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <rect x="3" y="7" width="10" height="7" rx="1" />
      <path d="M5.5 7V5a2.5 2.5 0 015 0v2" />
    </svg>
  );
}
