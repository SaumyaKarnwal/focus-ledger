import { useState } from "react";
import type { EstimatePb, SettingsPb } from "../gen/focusledger/v1/model_pb";
import { type ByMode, LOGGED_MODES, type LoggedMode } from "../ledger/rollup";
import { modeKey } from "../modes/modes";
import type { TaskRow } from "../tasks/tasksModel";
import { formatMinutes, MODE_NAMES } from "../today/todayModel";
import { SplitRing } from "../ui/SplitRing";
import {
  ESTIMATE_COUNT,
  ESTIMATE_LENGTH,
  type EstimateRow,
  estimateRows,
  estimateSummary,
  stepWithin,
  toEstimates,
} from "../tree/estimateModel";
import {
  chartHours,
  type DayBar,
  estimateFigures,
  lastSevenDays,
  ringParts,
} from "./taskPageModel";

type Estimate = Pick<EstimatePb, "mode" | "cycleMinutes" | "cycleCount">;

type Props = {
  row: TaskRow;
  path: string[];
  settings: SettingsPb;
  now: Date;
  timeZone: string;
  busy: boolean;
  onBack: () => void;
  onEdit: () => void;
  onSetCompleted: (completed: boolean) => void;
  /** Resolves true when the write succeeded. */
  onSaveEstimate: (estimates: Estimate[]) => Promise<boolean>;
};

/** The task page (boards E-Task, -Edit, -Pie, and -Done). */
export function TaskPage({
  row,
  path,
  settings,
  now,
  timeZone,
  busy,
  onBack,
  onEdit,
  onSetCompleted,
  onSaveEstimate,
}: Props) {
  const { node } = row;
  return (
    <div className="task-page">
      <div className="task-page-title">
        <button
          type="button"
          className="task-page-back"
          aria-label="Back to tasks"
          onClick={onBack}
        >
          <BackIcon />
        </button>
        <div className="task-page-heading">
          {path.length > 0 && (
            <span className="task-page-path">{path.join(" / ")}</span>
          )}
          <h1 className="task-page-name">
            <button
              type="button"
              aria-label={`Edit task, ${node.name}`}
              onClick={onEdit}
            >
              {node.name}
            </button>
          </h1>
        </div>
        <button
          type="button"
          className="task-page-complete"
          aria-pressed={node.closed}
          disabled={busy}
          onClick={() => onSetCompleted(!node.closed)}
        >
          <CheckIcon />
          {node.closed ? "Completed" : "Mark complete"}
        </button>
      </div>
      <div className="task-page-cards">
        <EstimateCard
          key={node.id}
          row={row}
          settings={settings}
          busy={busy}
          onSave={onSaveEstimate}
        />
        <SplitCard row={row} />
      </div>
      <DaysCard days={lastSevenDays(row, now, timeZone)} timeZone={timeZone} />
    </div>
  );
}

function EstimateCard({
  row,
  settings,
  busy,
  onSave,
}: {
  row: TaskRow;
  settings: SettingsPb;
  busy: boolean;
  onSave: (estimates: Estimate[]) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<ByMode<EstimateRow>>();
  const figures = estimateFigures(row);

  if (draft) {
    const save = async () => {
      const estimates = toEstimates(draft).filter(
        (line) => line.cycleCount > 0,
      );
      if (await onSave(estimates)) setDraft(undefined);
    };
    return (
      <section className="task-card" aria-label="Estimate">
        <div className="task-card-head">
          <h2 className="task-card-title">Estimate</h2>
          <span className="task-card-actions">
            <button
              type="button"
              className="task-card-cancel"
              onClick={() => setDraft(undefined)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="task-card-save"
              disabled={busy}
              onClick={() => void save()}
            >
              Save
            </button>
          </span>
        </div>
        <div className="estimate-total">
          <span className="estimate-big">
            {formatMinutes(estimateSummary(draft).minutes)}
          </span>
          <span className="estimate-of">estimated in total</span>
        </div>
        <div className="estimate-edit-rows">
          {LOGGED_MODES.map((mode) => (
            <EstimateEditLine
              key={mode}
              mode={mode}
              line={draft[mode]}
              onChange={(line) => setDraft({ ...draft, [mode]: line })}
            />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="task-card" aria-label="Estimate">
      <div className="task-card-head">
        <h2 className="task-card-title">Estimate</h2>
        <button
          type="button"
          className="task-card-icon"
          aria-label="Edit estimate"
          onClick={() => setDraft(estimateRows(row.node, settings))}
        >
          <PencilIcon />
        </button>
      </div>
      <div className="estimate-total">
        <span className="estimate-big">{formatMinutes(figures.logged)}</span>
        <span
          className="estimate-of"
          data-none={figures.estimate === 0 || undefined}
        >
          {figures.estimate > 0
            ? `of ${formatMinutes(figures.estimate)}`
            : "No estimate yet"}
        </span>
        {figures.estimate > 0 && (
          <span className="estimate-percent">
            {Math.round((figures.logged / figures.estimate) * 100)}%
          </span>
        )}
      </div>
      <div className="task-card-rule" />
      <div className="estimate-modes">
        {LOGGED_MODES.map((mode) => {
          const { logged, estimate } = figures.byMode[mode];
          return (
            <div key={mode} className="estimate-mode" data-mode={modeKey(mode)}>
              <div className="estimate-mode-line">
                <span className="estimate-mode-bar" aria-hidden="true" />
                <span className="estimate-mode-name">{MODE_NAMES[mode]}</span>
                <span className="estimate-mode-logged">
                  {formatMinutes(logged)}
                </span>
                {estimate > 0 && (
                  <span className="estimate-mode-of">
                    {" "}
                    of {formatMinutes(estimate)}
                  </span>
                )}
              </div>
              <div
                className="estimate-track"
                role="progressbar"
                aria-label={`${MODE_NAMES[mode]} against the estimate`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={
                  estimate > 0 ? Math.round((logged / estimate) * 100) : 0
                }
              >
                <span
                  style={{
                    width: `${estimate > 0 ? Math.min(100, (logged / estimate) * 100) : 0}%`,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
      {figures.onParts > 0 && (
        <p className="estimate-parts">
          Includes {formatMinutes(figures.onParts)} estimated on the parts
        </p>
      )}
    </section>
  );
}

function EstimateEditLine({
  mode,
  line,
  onChange,
}: {
  mode: LoggedMode;
  line: EstimateRow;
  onChange: (line: EstimateRow) => void;
}) {
  const name = MODE_NAMES[mode];
  return (
    <div className="estimate-edit-line" data-mode={modeKey(mode)}>
      <span className="estimate-mode-bar" aria-hidden="true" />
      <span className="estimate-edit-name">{name}</span>
      <Stepper
        label={`${name} minutes per cycle`}
        value={line.cycleMinutes}
        onStep={(sign) =>
          onChange({
            ...line,
            cycleMinutes: stepWithin(
              line.cycleMinutes,
              sign * ESTIMATE_LENGTH.step,
              ESTIMATE_LENGTH,
            ),
          })
        }
      />
      <span className="estimate-edit-unit">min</span>
      <span className="estimate-edit-unit" aria-hidden="true">
        ×
      </span>
      <Stepper
        label={`${name} cycles`}
        value={line.cycleCount}
        onStep={(sign) =>
          onChange({
            ...line,
            cycleCount: stepWithin(
              line.cycleCount,
              sign * ESTIMATE_COUNT.step,
              ESTIMATE_COUNT,
            ),
          })
        }
      />
      <span className="estimate-edit-unit estimate-edit-cycles">cycles</span>
    </div>
  );
}

function Stepper({
  label,
  value,
  onStep,
}: {
  label: string;
  value: number;
  onStep: (sign: 1 | -1) => void;
}) {
  return (
    <span className="estimate-edit-stepper" role="group" aria-label={label}>
      <button
        type="button"
        aria-label={`${label}: less`}
        onClick={() => onStep(-1)}
      >
        −
      </button>
      <output aria-label={label}>{value}</output>
      <button
        type="button"
        aria-label={`${label}: more`}
        onClick={() => onStep(1)}
      >
        +
      </button>
    </span>
  );
}

function SplitCard({ row }: { row: TaskRow }) {
  const parts = ringParts(row);
  const total = parts.reduce((sum, part) => sum + part.minutes, 0);
  const isModeSplit = row.children.length === 0;

  return (
    <section
      className="task-card"
      aria-label={`How it splits across ${row.node.name}`}
    >
      <div className="task-card-head">
        <h2 className="task-card-title">
          How it splits across {row.node.name}
        </h2>
      </div>
      {total === 0 ? (
        <p className="task-card-empty">No time logged yet.</p>
      ) : (
        <SplitRing
          parts={parts}
          label={`Time split across the parts of ${row.node.name}`}
          caption={
            isModeSplit
              ? "by mode"
              : `across ${parts.length} ${parts.length === 1 ? "part" : "parts"}`
          }
          showModes={!isModeSplit}
        />
      )}
    </section>
  );
}

function DaysCard({
  days,
  timeZone,
}: {
  days: readonly DayBar[];
  timeZone: string;
}) {
  const hours = chartHours(days);
  const pxPerHour = 140 / hours;
  const week = days.reduce((sum, day) => sum + day.total, 0);
  // The bar under the pointer, in focus, or tapped (README rule 10).
  const [active, setActive] = useState<number>();
  const activeDay = active === undefined ? undefined : days[active];
  return (
    <section className="task-card" aria-label="Last seven days">
      <div className="task-card-head">
        <h2 className="task-card-title">Last seven days</h2>
        <span className="days-legend">
          {LOGGED_MODES.map((mode) => (
            <span key={mode} className="days-key" data-mode={modeKey(mode)}>
              <span className="days-key-bar" aria-hidden="true" />
              {MODE_NAMES[mode]}
            </span>
          ))}
          <span className="days-week">{formatMinutes(week)} this week</span>
        </span>
      </div>
      <div className="days-chart">
        {Array.from({ length: hours }, (_, index) => index + 1).map((hour) => (
          <div
            key={hour}
            className="days-grid"
            style={{ bottom: `${hour * pxPerHour}px` }}
            aria-hidden="true"
          >
            <span>{hour}h</span>
          </div>
        ))}
        <ol className="days-bars">
          {days.map((day, index) => (
            <li
              key={day.range.start.toISOString()}
              aria-label={`${dayLabel(day, timeZone)}: ${day.total > 0 ? formatMinutes(day.total) : "nothing"}`}
              tabIndex={0}
              data-dim={active !== undefined && active !== index}
              onMouseEnter={() => setActive(index)}
              onMouseLeave={() => setActive(undefined)}
              onFocus={() => setActive(index)}
              onBlur={() => setActive(undefined)}
              onClick={() =>
                setActive((current) => (current === index ? undefined : index))
              }
            >
              <span className="days-total" data-none={day.total === 0}>
                {day.total === 0 ? "—" : ""}
              </span>
              <span className="days-stack">
                {LOGGED_MODES.filter((mode) => day.byMode[mode] > 0).map(
                  (mode) => (
                    <span
                      key={mode}
                      data-mode={modeKey(mode)}
                      style={{
                        height: `${(day.byMode[mode] / 60) * pxPerHour}px`,
                      }}
                    />
                  ),
                )}
              </span>
            </li>
          ))}
        </ol>
        {activeDay && active !== undefined && (
          <div
            className="split-tip days-tip"
            role="tooltip"
            data-edge={active > 3 ? "end" : undefined}
            style={{
              left: `calc(30px + (100% - 30px) * ${(active + 0.5) / days.length})`,
            }}
          >
            <div className="split-tip-head">
              <span className="split-tip-name">
                {dayLabel(activeDay, timeZone)}
              </span>
              <span className="split-minutes">
                {formatMinutes(activeDay.total)}
              </span>
            </div>
            {LOGGED_MODES.map((mode) => (
              <div
                key={mode}
                className="split-tip-mode"
                data-mode={modeKey(mode)}
                data-zero={activeDay.byMode[mode] === 0 || undefined}
              >
                <span className="estimate-mode-bar" aria-hidden="true" />
                <span>{MODE_NAMES[mode]}</span>
                <span className="split-tip-minutes">
                  {formatMinutes(activeDay.byMode[mode])}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="days-axis" />
      <div className="days-labels" aria-hidden="true">
        {days.map((day) => (
          <span key={day.range.start.toISOString()} data-today={day.isToday}>
            {dayLabel(day, timeZone)}
          </span>
        ))}
      </div>
    </section>
  );
}

function dayLabel(day: DayBar, timeZone: string): string {
  if (day.isToday) return "Today";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      day: "numeric",
    })
      .formatToParts(day.range.start)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.weekday} ${parts.day}`;
}

function BackIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M13 8H3M7.5 3.5L3 8l4.5 4.5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle className="check-circle" cx="8" cy="8" r="6.6" />
      <path
        className="check-mark"
        d="M5 8.2l2 2 4-4.1"
        fill="none"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11.2 2.4l2.4 2.4L5.4 13 2 14l1-3.4z" />
    </svg>
  );
}
