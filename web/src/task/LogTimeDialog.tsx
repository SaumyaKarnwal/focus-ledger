import { create } from "@bufbuild/protobuf";
import { useEffect, useState } from "react";
import {
  type CyclePb,
  type NodePb,
  NodePbSchema,
} from "../gen/focusledger/v1/model_pb";
import {
  localDateString,
  monthRange,
  type TimeRange,
  zonedDateTimeToInstant,
} from "../ledger/period";
import { LOGGED_MODES, type LoggedMode } from "../ledger/rollup";
import { TaskPicker } from "../start/TaskPicker";
import { type EstimateRow, estimateRows } from "../tree/estimateModel";
import {
  INBOX_ID,
  knownNodes,
  pathOf,
  type TodayData,
} from "../today/todayModel";
import { EstimateLine } from "./EstimateLine";
import {
  cycleDaysOf,
  dayLabel,
  endClock,
  type LogDraft,
  type Meridiem,
  monthGrid,
  monthLabel,
  parseStartTime,
  shiftMonth,
  totalMinutes,
  whenLabel,
} from "./logTimeModel";
import type { TaskSave } from "./saveTask";
import { TaskDialog } from "./TaskDialog";

type Props = {
  data: TodayData;
  now: Date;
  timeZone: string;
  /** The task it opens on: a task page's own task, or the last task worked. */
  initialNodeId: string;
  /** The cycles that started in a range, for the calendar's dots. */
  listCycles: (range: TimeRange) => Promise<CyclePb[]>;
  onSaveTask: (save: TaskSave) => Promise<NodePb | undefined>;
  /** Writes the cycles. Without it, Log stays disabled. */
  onLog?: (draft: LogDraft) => Promise<void>;
  onClose: () => void;
};

type Layer = "picker" | "calendar" | "new-task";

const WEEKDAY_HEADS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/**
 * Log time (README "Log time", boards G-Tasks-Log*, E-Task-Log): cycles run
 * without the timer. The dialog keeps one size; the task picker and the
 * calendar float over it.
 */
export function LogTimeDialog({
  data,
  now,
  timeZone,
  initialNodeId,
  listCycles,
  onSaveTask,
  onLog,
  onClose,
}: Props) {
  const today = localDateString(now, timeZone);
  const [nodeId, setNodeId] = useState(initialNodeId);
  const [day, setDay] = useState(today);
  const [startText, setStartText] = useState("");
  const [meridiem, setMeridiem] = useState<Meridiem>();
  const [time, setTime] = useState(() =>
    estimateRows(create(NodePbSchema), data.settings),
  );
  const [layer, setLayer] = useState<Layer>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const start = parseStartTime(startText, meridiem);
  const minutes = totalMinutes(time);
  const canLog = start !== undefined && minutes > 0 && !busy;

  const nodes = knownNodes(data);
  // The Inbox node also has the ID "": it is "Not sure yet", not a task.
  const node =
    nodeId === INBOX_ID
      ? undefined
      : nodes.find((listed) => listed.id === nodeId);
  const taskName = node ? node.name : "Not sure yet";
  const taskPath = node ? pathOf(node, nodes).join(" / ") : "goes to Untagged";

  const setRow = (mode: LoggedMode, row: EstimateRow) =>
    setTime((current) => ({ ...current, [mode]: row }));

  const log = async () => {
    if (!canLog || !onLog || start === undefined) return;
    setBusy(true);
    setError(undefined);
    try {
      await onLog({ nodeId, day, start, time });
      onClose();
    } catch {
      setError("The time was not logged. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="picker-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="task-dialog log-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Log time"
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          // The innermost layer closes first.
          if (layer) setLayer(undefined);
          else if (!busy) onClose();
        }}
      >
        <button
          type="button"
          className="log-task"
          aria-label={`Task: ${taskName}`}
          onClick={() => setLayer("picker")}
        >
          <span className="log-task-name">{taskName}</span>
          <span className="log-task-path">{taskPath}</span>
          <Chevron />
        </button>
        <button
          type="button"
          className="task-dialog-parent log-when"
          aria-expanded={layer === "calendar"}
          aria-haspopup="dialog"
          data-open={layer === "calendar" || undefined}
          onClick={() =>
            setLayer((current) =>
              current === "calendar" ? undefined : "calendar",
            )
          }
        >
          <span className="task-dialog-label">When</span>
          <span className="task-dialog-parent-path">
            {whenLabel(day, start, now, timeZone)}
          </span>
          <Chevron />
        </button>
        <div className="task-dialog-estimate" role="group" aria-label="Time">
          <div className="task-dialog-estimate-head">
            <span className="task-dialog-label">Time</span>
            <span className="task-dialog-hint">length × cycles</span>
          </div>
          {LOGGED_MODES.map((mode) => (
            <EstimateLine
              key={mode}
              mode={mode}
              row={time[mode]}
              lit
              onChange={(row) => setRow(mode, row)}
            />
          ))}
        </div>
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        <div className="task-dialog-actions log-actions">
          <button
            type="button"
            className="cancel-button"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="task-dialog-save"
            disabled={!canLog || onLog === undefined}
            onClick={() => void log()}
          >
            Log
          </button>
        </div>
        {layer === "calendar" && (
          <>
            <div
              className="log-layer"
              aria-hidden="true"
              onMouseDown={() => setLayer(undefined)}
            />
            <Calendar
              day={day}
              today={today}
              timeZone={timeZone}
              listCycles={listCycles}
              startText={startText}
              meridiem={meridiem}
              end={
                start === undefined || minutes === 0
                  ? undefined
                  : endClock(start, minutes)
              }
              onDay={setDay}
              onStartText={setStartText}
              onMeridiem={setMeridiem}
            />
          </>
        )}
        {layer === "picker" && (
          <TaskPicker
            data={data}
            now={now}
            timeZone={timeZone}
            currentNodeId={nodeId}
            floating
            onPick={(picked) => {
              setNodeId(picked);
              setLayer(undefined);
            }}
            onNewTask={() => setLayer("new-task")}
            onClose={() => setLayer(undefined)}
          />
        )}
        {layer === "new-task" && (
          <TaskDialog
            data={data}
            onSave={onSaveTask}
            onDone={(created) => {
              setNodeId(created.id);
              setLayer(undefined);
            }}
            onClose={() => setLayer(undefined)}
          />
        )}
      </section>
    </div>
  );
}

/** The day and the start time (boards G-Tasks-Log-When, -Day). */
function Calendar({
  day,
  today,
  timeZone,
  listCycles,
  startText,
  meridiem,
  end,
  onDay,
  onStartText,
  onMeridiem,
}: {
  day: string;
  today: string;
  timeZone: string;
  listCycles: (range: TimeRange) => Promise<CyclePb[]>;
  startText: string;
  meridiem?: Meridiem;
  end?: string;
  onDay: (day: string) => void;
  onStartText: (text: string) => void;
  onMeridiem: (meridiem: Meridiem) => void;
}) {
  const [month, setMonth] = useState(day.slice(0, 7));
  const [cycleDays, setCycleDays] = useState<ReadonlySet<string>>(new Set());
  const thisMonth = today.slice(0, 7);

  useEffect(() => {
    let current = true;
    const middle = zonedDateTimeToInstant(`${month}-15`, "12:00", timeZone);
    listCycles(monthRange(middle, timeZone)).then(
      (cycles) => {
        if (current) setCycleDays(cycleDaysOf(cycles, timeZone));
      },
      // The dots are a hint: without them, every day can still be picked.
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [listCycles, month, timeZone]);

  return (
    <div className="log-calendar" role="dialog" aria-label="When">
      <div className="log-calendar-head">
        <span className="log-calendar-month">{monthLabel(month)}</span>
        <button
          type="button"
          className="log-calendar-step"
          aria-label="Earlier month"
          onClick={() => setMonth(shiftMonth(month, -1))}
        >
          <Chevron direction="left" />
        </button>
        <button
          type="button"
          className="log-calendar-step"
          aria-label="Later month"
          disabled={month >= thisMonth}
          onClick={() => setMonth(shiftMonth(month, 1))}
        >
          <Chevron />
        </button>
      </div>
      <div
        className="log-calendar-grid"
        role="grid"
        aria-label={monthLabel(month)}
      >
        {WEEKDAY_HEADS.map((head) => (
          <span key={head} className="log-calendar-weekday" aria-hidden="true">
            {head}
          </span>
        ))}
        {monthGrid(month, today, cycleDays).map((cell, index) =>
          cell === undefined ? (
            <span key={`empty-${index}`} />
          ) : (
            <button
              key={cell.date}
              type="button"
              className="log-calendar-day"
              aria-label={dayLabel(cell.date)}
              aria-pressed={cell.date === day}
              aria-current={cell.isToday ? "date" : undefined}
              data-dot={cell.hasCycles || undefined}
              disabled={cell.isFuture}
              onClick={() => onDay(cell.date)}
            >
              {cell.day}
            </button>
          ),
        )}
      </div>
      <div className="log-calendar-start">
        <label className="log-start-label" htmlFor="log-start">
          Start
        </label>
        <input
          id="log-start"
          className="log-start"
          aria-label="Start time"
          placeholder="--:--"
          inputMode="numeric"
          maxLength={5}
          autoFocus
          value={startText}
          onChange={(event) => onStartText(event.target.value)}
        />
        <span className="log-meridiem" role="group" aria-label="am or pm">
          {(["am", "pm"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={meridiem === option}
              onClick={() => onMeridiem(option)}
            >
              {option}
            </button>
          ))}
        </span>
        {end && <span className="log-end">→ {end}</span>}
      </div>
    </div>
  );
}

function Chevron({ direction = "right" }: { direction?: "left" | "right" }) {
  return (
    <svg
      width="8"
      height="12"
      viewBox="0 0 9 13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path
        d={direction === "right" ? "M1.5 1.5l5 5-5 5" : "M7.5 1.5l-5 5 5 5"}
      />
    </svg>
  );
}
