import { useEffect, useState } from "react";
import { LOGGED_MODES } from "../ledger/rollup";
import { modeKey } from "../modes/modes";
import { BarTip } from "../ui/BarTip";
import { useBarFocus } from "../ui/useBarFocus";
import { formatMinutes, MODE_NAMES } from "../today/todayModel";
import type { PlacedCycle } from "./reportCards";
import { type DayBar, finishedCycles, setAndDo, type Year } from "./reportYear";

/** What you set, what you do (Report rules 4). */
export function SetAndDoCard({ cycles }: { cycles: readonly PlacedCycle[] }) {
  const rows = setAndDo(cycles);
  // The track runs a quarter past the longest planned length, as on the board.
  const scale =
    Math.max(1, ...rows.map((row) => Math.max(row.set, row.done))) * 1.25;
  return (
    <section className="task-card" aria-labelledby="report-set">
      <div className="task-card-head">
        <h2 id="report-set" className="task-card-title">
          What you set, what you do
        </h2>
      </div>
      <ul className="report-kind-list">
        {rows.map((row) => (
          <li key={row.mode} data-mode={modeKey(row.mode)}>
            <span className="estimate-mode-bar" aria-hidden="true" />
            <span className="report-kind-name">{MODE_NAMES[row.mode]}</span>
            <span className="report-set-figures">
              {row.cycles === 0 ? (
                "no cycles"
              ) : (
                <>
                  set <strong>{row.set}m</strong> · avg{" "}
                  <strong>{row.done}m</strong>
                </>
              )}
            </span>
            <span className="report-kind-track" aria-hidden="true">
              <span style={{ width: `${(row.done / scale) * 100}%` }} />
              {row.cycles > 0 && (
                <span
                  className="report-set-mark"
                  style={{ left: `${(row.set / scale) * 100}%` }}
                />
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Cycles you finished: a filled mark ran to the bell, an outlined one was stopped early. */
export function FinishedCard({ cycles }: { cycles: readonly PlacedCycle[] }) {
  const counts = finishedCycles(cycles);
  const [list, setList] = useState<HTMLUListElement | null>(null);
  const perRow = useMarksPerRow(list);
  return (
    <section className="task-card" aria-labelledby="report-finished">
      <div className="task-card-head">
        <h2 id="report-finished" className="task-card-title">
          Cycles you finished
        </h2>
      </div>
      <ul className="report-finished" ref={setList}>
        {LOGGED_MODES.map((mode) => {
          const { bell, stopped } = counts[mode];
          const total = bell + stopped;
          // More marks than two rows hold become one bar (polish rule 3).
          const asBar = total > 2 * perRow;
          return (
            <li key={mode} data-mode={modeKey(mode)}>
              <span className="report-kind-name">{MODE_NAMES[mode]}</span>
              {asBar ? (
                <span
                  className="report-finished-bar"
                  role="img"
                  aria-label={`${bell} ran to the bell, ${stopped} stopped early`}
                >
                  <span style={{ width: `${(bell / total) * 100}%` }} />
                </span>
              ) : (
                <span className="report-marks" aria-hidden="true">
                  {[
                    ...Array.from({ length: bell }, () => true),
                    ...Array.from({ length: stopped }, () => false),
                  ].map((filled, index) => (
                    <span
                      key={index}
                      className="report-mark"
                      data-filled={filled || undefined}
                    />
                  ))}
                </span>
              )}
              <span className="report-finished-count">
                {bell} of {total}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// A mark is 24px wide with a 4px gap (report.css).
const MARK_STEP = 28;
// Before the first layout, and in tests without layout, assume a narrow card.
const MARKS_PER_ROW_UNKNOWN = 8;

/** How many marks fit on one row of the card, from the width the marks get. */
function useMarksPerRow(list: HTMLUListElement | null): number {
  const [perRow, setPerRow] = useState(MARKS_PER_ROW_UNKNOWN);
  useEffect(() => {
    if (!list || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const marks = list.querySelector(".report-marks, .report-finished-bar");
      const width = marks?.getBoundingClientRect().width ?? 0;
      if (width > 0)
        setPerRow(Math.max(1, Math.floor((width + 4) / MARK_STEP)));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [list]);
  return perRow;
}

/** The small third card: the days of a week, or the weeks of a month. */
export function BarsCard({
  title,
  bars,
}: {
  title: string;
  bars: readonly DayBar[];
}) {
  const most = Math.max(1, ...bars.map((bar) => bar.minutes));
  const { active, barProps } = useBarFocus();
  const activeBar = active === undefined ? undefined : bars[active];
  const valueOf = (bar: DayBar) =>
    bar.future
      ? "to come"
      : bar.minutes === 0
        ? "No focus"
        : formatMinutes(bar.minutes);
  return (
    <section className="task-card" aria-labelledby="report-bars">
      <div className="task-card-head">
        <h2 id="report-bars" className="task-card-title">
          {title}
        </h2>
      </div>
      <div className="report-bars-chart">
        <ol className="report-bars">
          {bars.map((bar, index) => (
            <li
              key={bar.label}
              data-current={bar.current || undefined}
              aria-label={`${bar.label}: ${valueOf(bar)}`}
              {...barProps(index)}
            >
              <span className="report-bar-column">
                <span style={{ height: `${(bar.minutes / most) * 100}%` }} />
              </span>
              <span className="report-bar-label">{bar.label}</span>
            </li>
          ))}
        </ol>
        {activeBar && active !== undefined && (
          <BarTip index={active} count={bars.length} className="report-bar-tip">
            <div className="split-tip-head">
              <span className="split-tip-name">{activeBar.label}</span>
              <span className="split-minutes">{valueOf(activeBar)}</span>
            </div>
          </BarTip>
        )}
      </div>
    </section>
  );
}

/** Your year: always the last twelve months, whatever the range above. */
export function YearCard({ year }: { year: Year }) {
  const days = year.weeks.flat().filter((day) => day !== undefined);
  const [active, setActive] = useState<string>();
  const [place, setPlace] = useState<{ left: number; top: number }>();
  const activeDay = days.find((day) => day.date === active);
  const show = (date: string | undefined, cell?: HTMLElement | null) => {
    setActive(date);
    setPlace(
      cell
        ? { left: cell.offsetLeft + cell.offsetWidth / 2, top: cell.offsetTop }
        : undefined,
    );
  };
  const cellOf = (grid: HTMLElement, date: string) =>
    grid.querySelector<HTMLElement>(`[data-date="${date}"]`);
  // The arrow keys move a week left or right, or a day up or down.
  const moveBy = (grid: HTMLElement, steps: number) => {
    const index = days.findIndex((day) => day.date === active);
    const next = days[Math.min(days.length - 1, Math.max(0, index + steps))];
    show(next.date, cellOf(grid, next.date));
  };
  return (
    <section className="task-card report-wide" aria-labelledby="report-year">
      <div className="task-card-head">
        <h2 id="report-year" className="task-card-title">
          Your year
        </h2>
      </div>
      <div className="report-year-frame">
        <div
          className="report-year"
          role="group"
          tabIndex={0}
          aria-label={`${year.daysWithFocus} days with focus since ${year.since}. Use the arrow keys to read each day.`}
          style={{
            gridTemplateColumns: `28px repeat(${year.weeks.length}, minmax(0, 1fr))`,
          }}
          onFocus={(event) => {
            const today = days.at(-1);
            if (!active && today)
              show(today.date, cellOf(event.currentTarget, today.date));
          }}
          onBlur={() => show(undefined)}
          onKeyDown={(event) => {
            const steps = {
              ArrowLeft: -7,
              ArrowRight: 7,
              ArrowUp: -1,
              ArrowDown: 1,
            }[event.key];
            if (steps === undefined || !active) return;
            event.preventDefault();
            moveBy(event.currentTarget, steps);
          }}
        >
          {["Mon", "Wed", "Fri"].map((name, index) => (
            <span
              key={name}
              className="report-year-label"
              aria-hidden="true"
              style={{ gridColumn: 1, gridRow: 2 + index * 2 }}
            >
              {name}
            </span>
          ))}
          {year.months.map((month, index) =>
            month ? (
              <span
                key={`month-${index}`}
                className="report-year-label"
                aria-hidden="true"
                style={{ gridColumn: index + 2, gridRow: 1 }}
              >
                {month}
              </span>
            ) : null,
          )}
          {year.weeks.flatMap((week, index) =>
            week.map((day, dayIndex) =>
              day ? (
                <span
                  key={day.date}
                  className="report-year-day"
                  data-date={day.date}
                  data-level={day.level}
                  data-active={day.date === active || undefined}
                  style={{ gridColumn: index + 2, gridRow: dayIndex + 2 }}
                  onMouseEnter={(event) => show(day.date, event.currentTarget)}
                  onMouseLeave={() => show(undefined)}
                  onClick={(event) =>
                    day.date === active
                      ? show(undefined)
                      : show(day.date, event.currentTarget)
                  }
                />
              ) : null,
            ),
          )}
        </div>
        {activeDay && (
          <div
            className="split-tip report-year-tip"
            aria-hidden="true"
            style={place ? { left: place.left, top: place.top } : undefined}
          >
            <span className="split-tip-name">{dayLabel(activeDay.date)}</span>
            <span className="split-minutes">{dayTotal(activeDay.minutes)}</span>
          </div>
        )}
        <span className="visually-hidden" role="status">
          {activeDay
            ? `${dayLabel(activeDay.date)} · ${dayTotal(activeDay.minutes)}`
            : ""}
        </span>
      </div>
      <div className="report-year-foot">
        <span>
          {year.daysWithFocus} days with focus since {year.since}.
        </span>
        <span className="report-year-scale" aria-hidden="true">
          Less
          {[0, 1, 2, 3, 4].map((level) => (
            <span key={level} className="report-year-day" data-level={level} />
          ))}
          More
        </span>
      </div>
    </section>
  );
}

// "Tue 22 Sep", from a local date ("2026-09-22").
function dayLabel(date: string): string {
  const day = new Date(`${date}T12:00:00Z`);
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...options }).format(
      day,
    );
  return `${part({ weekday: "short" })} ${part({ day: "numeric" })} ${part({ month: "short" })}`;
}

function dayTotal(minutes: number): string {
  return minutes === 0 ? "No focus" : formatMinutes(minutes);
}
