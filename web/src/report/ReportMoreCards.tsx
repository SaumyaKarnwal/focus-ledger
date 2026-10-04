import { useEffect, useState } from "react";
import { LOGGED_MODES } from "../ledger/rollup";
import { modeKey } from "../modes/modes";
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
  return (
    <section className="task-card" aria-labelledby="report-bars">
      <div className="task-card-head">
        <h2 id="report-bars" className="task-card-title">
          {title}
        </h2>
      </div>
      <ol className="report-bars">
        {bars.map((bar) => (
          <li
            key={bar.label}
            data-current={bar.current || undefined}
            aria-label={`${bar.label}: ${bar.future ? "to come" : formatMinutes(bar.minutes)}`}
          >
            <span className="report-bar-value">
              {bar.future || bar.minutes === 0
                ? ""
                : formatMinutes(bar.minutes)}
            </span>
            <span className="report-bar-column">
              <span style={{ height: `${(bar.minutes / most) * 100}%` }} />
            </span>
            <span className="report-bar-label">{bar.label}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Your year: always the last twelve months; the only place with a streak. */
export function YearCard({ year }: { year: Year }) {
  return (
    <section className="task-card report-wide" aria-labelledby="report-year">
      <div className="task-card-head">
        <h2 id="report-year" className="task-card-title">
          Your year
        </h2>
        <span className="report-streak">
          <strong>{year.streak}</strong> days in a row
          <span className="report-streak-best">
            best <strong>{year.best}</strong>
          </span>
        </span>
      </div>
      <div
        className="report-year"
        role="img"
        aria-label={`${year.daysWithFocus} days with focus since ${year.since}`}
        style={{
          gridTemplateColumns: `28px repeat(${year.weeks.length}, minmax(0, 1fr))`,
        }}
      >
        {["Mon", "Wed", "Fri"].map((name, index) => (
          <span
            key={name}
            className="report-year-label"
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
                data-level={day.level}
                title={`${day.date}: ${formatMinutes(day.minutes)}`}
                style={{ gridColumn: index + 2, gridRow: dayIndex + 2 }}
              />
            ) : null,
          ),
        )}
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
