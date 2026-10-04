import { type FormEvent, useState } from "react";
import type { CyclePb } from "../gen/focusledger/v1/model_pb";
import type { LoggedMode } from "../ledger/rollup";
import { modeKey } from "../modes/modes";
import { StartScreen } from "../start/StartScreen";
import {
  cycleContext,
  MODE_NAMES,
  type TodayData,
  taskAfterCycle,
} from "../today/todayModel";

const MAX_CYCLE_MINUTES = 1440;

type Props = {
  data: TodayData;
  cycle: CyclePb;
  timeZone: string;
  busy: boolean;
  onExtend: (moreMinutes: number) => void;
  onBreak: () => void;
  onNewCycle: () => void;
  onOpenTasks: () => void;
  onOpenSettings: () => void;
  onOpenReport?: () => void;
  onSignOut: () => void;
};

/**
 * The bell (boards C-Desk-Bell2 and -Bell2-Empty): a dialog over the Start
 * screen. The cycle is already written, and the bell never asks for the mode
 * again (FR-4.3).
 */
export function BellScreen({
  data,
  cycle,
  timeZone,
  busy,
  onExtend,
  onBreak,
  onNewCycle,
  onOpenTasks,
  onOpenSettings,
  onOpenReport,
  onSignOut,
}: Props) {
  const [moreMinutes, setMoreMinutes] = useState("");
  const logged = cycle.minutes ?? 0;
  const extension = Number(moreMinutes);
  const validExtension =
    moreMinutes !== "" &&
    Number.isInteger(extension) &&
    extension >= 1 &&
    logged + extension <= MAX_CYCLE_MINUTES;
  const mode = cycle.mode as LoggedMode;
  const { nodeName } = cycleContext(data, cycle);
  const isInbox = cycle.nodeId === undefined;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!validExtension) return;
    onExtend(extension);
    setMoreMinutes("");
  };

  const dialog = (
    // The header stays usable over the scrim: clicks outside the dialog pass through.
    <div className="picker-scrim" data-pass-through="true">
      <section
        className="bell"
        role="dialog"
        aria-labelledby="bell-heading"
        data-mode={modeKey(mode)}
      >
        <div className="bell-heading">
          <span className="bell-bar" aria-hidden="true" />
          <div>
            <h2 id="bell-heading" className="bell-title">
              {MODE_NAMES[mode]}
              {!isInbox && (
                <>
                  {" "}
                  <span className="bell-separator">·</span> {nodeName}
                </>
              )}
            </h2>
            <p className="visually-hidden">{logged} min logged</p>
          </div>
        </div>
        <form className="bell-field" onSubmit={submit}>
          <span aria-hidden="true">Keep going for</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_CYCLE_MINUTES - logged}
            placeholder="00"
            aria-label="Keep going for more minutes"
            value={moreMinutes}
            onChange={(event) => setMoreMinutes(event.target.value)}
          />
          <span aria-hidden="true">more minutes</span>
          <button
            type="submit"
            className="bell-go"
            aria-label="Keep going"
            disabled={busy || !validExtension}
          >
            <svg
              width="18"
              height="12"
              viewBox="0 0 19 13"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M1 6.5h16M12 1.5l5 5-5 5" />
            </svg>
          </button>
        </form>
        <div className="bell-actions">
          <button
            type="button"
            className="bell-outline"
            disabled={busy}
            onClick={onBreak}
          >
            Take a break
          </button>
          <button
            type="button"
            className="bell-primary"
            disabled={busy}
            onClick={onNewCycle}
          >
            Start a new cycle
          </button>
        </div>
      </section>
    </div>
  );

  return (
    <StartScreen
      data={data}
      timeZone={timeZone}
      busy
      initialNodeId={taskAfterCycle(data, cycle)}
      initialMode={mode}
      overlay={dialog}
      onStart={() => {}}
      onBreak={() => {}}
      onSaveTask={async () => undefined}
      onOpenTasks={onOpenTasks}
      onOpenSettings={onOpenSettings}
      onOpenReport={onOpenReport}
      onSignOut={onSignOut}
    />
  );
}
