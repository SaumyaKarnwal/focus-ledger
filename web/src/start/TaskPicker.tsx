import { type KeyboardEvent, useId, useState } from "react";
import { modeKey } from "../modes/modes";
import { formatMinutes, INBOX_ID, type TodayData } from "../today/todayModel";
import { inboxMinutesToday, inboxMode, pickerRows } from "./pickerModel";

type Props = {
  data: TodayData;
  now: Date;
  timeZone: string;
  currentNodeId: string;
  onPick: (nodeId: string) => void;
  onNewTask: () => void;
  onClose: () => void;
};

/**
 * The task picker over Start (board C-Desk-Start-Pick). The search field keeps
 * the focus: up and down move, enter picks, escape closes.
 */
export function TaskPicker({
  data,
  now,
  timeZone,
  currentNodeId,
  onPick,
  onNewTask,
  onClose,
}: Props) {
  const ids = useId();
  const [query, setQuery] = useState("");
  const rows = pickerRows(data, now, timeZone, query);
  // No task at all yet (board C-Desk-Start-Pick-Empty): only Not sure yet.
  const noTasks = rows.length === 0 && query.trim() === "";
  // The Inbox ("Not sure yet") is the last option.
  const options = [...rows.map((row) => row.nodeId), INBOX_ID];
  const [highlighted, setHighlighted] = useState(() =>
    options.includes(currentNodeId) ? currentNodeId : (options[0] ?? INBOX_ID),
  );
  const active = options.includes(highlighted) ? highlighted : options[0];
  const optionId = (nodeId: string) => `${ids}-${nodeId || "inbox"}`;
  const inboxToday = inboxMinutesToday(data, now, timeZone);
  const latestInboxMode = inboxMode(data);

  const keyDown = (event: KeyboardEvent) => {
    const index = options.indexOf(active);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlighted(options[Math.min(options.length - 1, index + 1)]);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted(options[Math.max(0, index - 1)]);
    } else if (event.key === "Enter") {
      event.preventDefault();
      onPick(active);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  const optionProps = (nodeId: string) => ({
    id: optionId(nodeId),
    role: "option",
    "aria-selected": nodeId === active,
    "data-current": nodeId === currentNodeId,
    className: "picker-option",
    onMouseEnter: () => setHighlighted(nodeId),
    onClick: () => onPick(nodeId),
  });

  return (
    <div
      className="picker-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${ids}-title`}
      >
        <h2 id={`${ids}-title`} className="visually-hidden">
          Choose a task
        </h2>
        <label className="picker-search">
          <SearchIcon />
          <span className="visually-hidden">Search tasks</span>
          <input
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={`${ids}-list`}
            aria-activedescendant={optionId(active)}
            placeholder="Search tasks"
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={keyDown}
          />
        </label>
        <div
          className="picker-body"
          id={`${ids}-list`}
          role="listbox"
          aria-label="Tasks"
        >
          <div className="picker-recent" data-empty={noTasks || undefined}>
            {rows.map((row) => (
              <div key={row.nodeId} {...optionProps(row.nodeId)}>
                <span
                  className="picker-bar"
                  data-mode={
                    row.mode === undefined ? undefined : modeKey(row.mode)
                  }
                  aria-hidden="true"
                />
                <span className="picker-text">
                  <span className="picker-name">{row.name}</span>
                  <span className="picker-detail">{row.detail}</span>
                </span>
                <span className="picker-figure">{row.figure}</span>
              </div>
            ))}
            {rows.length === 0 && query.trim() !== "" && (
              <p className="picker-none">No task matches “{query.trim()}”.</p>
            )}
          </div>
          <div className="picker-inbox">
            <div {...optionProps(INBOX_ID)}>
              <span
                className="picker-bar"
                data-mode={
                  latestInboxMode === undefined
                    ? undefined
                    : modeKey(latestInboxMode)
                }
                aria-hidden="true"
              />
              <span className="picker-text">
                <span className="picker-name">Not sure yet</span>
                <span className="picker-detail">
                  name it later, or never
                  {inboxToday > 0 && ` · ${formatMinutes(inboxToday)} today`}
                </span>
              </span>
              {inboxToday > 0 && (
                <span className="picker-figure">
                  {formatMinutes(inboxToday)}
                </span>
              )}
            </div>
          </div>
        </div>
        <footer className="picker-footer">
          <button type="button" className="picker-new" onClick={onNewTask}>
            <PlusIcon />
            New task
          </button>
          {!noTasks && (
            <span className="picker-keys" aria-hidden="true">
              ↑↓ move · ↵ pick · esc close
            </span>
          )}
        </footer>
      </section>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="7" cy="7" r="5" />
      <path d="M10.6 10.6L14 14" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M7 2v10M2 7h10" />
    </svg>
  );
}
