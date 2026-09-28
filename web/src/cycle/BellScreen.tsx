import { type FormEvent, useState } from "react";
import type { CyclePb } from "../gen/focusledger/v1/model_pb";
import type { LoggedMode } from "../ledger/rollup";
import { modeKey } from "../modes/modes";
import { MODE_NAMES } from "../today/todayModel";
import { PageHeader } from "../ui/PageHeader";

const MAX_CYCLE_MINUTES = 1440;

type Props = {
  cycle: CyclePb;
  nodeName: string;
  path: string[];
  busy: boolean;
  onExtend: (moreMinutes: number) => void;
  onBreak: () => void;
  onNewCycle: () => void;
};

/** The cycle is already written. The bell never asks for the mode again (FR-4.3). */
export function BellScreen({
  cycle,
  nodeName,
  path,
  busy,
  onExtend,
  onBreak,
  onNewCycle,
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

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!validExtension) return;
    onExtend(extension);
    setMoreMinutes("");
  };

  return (
    <div className="bell-page">
      <PageHeader
        framed
        middle={
          path.length > 0 ? (
            <span className="crumb">{path.join(" / ")}</span>
          ) : undefined
        }
        end={<span className="mono">00:00</span>}
      />
      <div className="bell-body">
        <section className="sheet" aria-labelledby="bell-heading">
          <div className="sheet-heading">
            <span className="sheet-chip" data-mode={modeKey(mode)}>
              <span className="mode-bar" aria-hidden="true" />
              {MODE_NAMES[mode]} · logged
            </span>
            <h2 id="bell-heading" className="title title-l">
              {nodeName}
            </h2>
            <p className="note">{logged} min logged</p>
          </div>
          <form onSubmit={submit}>
            <div className="extend-field">
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
                className="extend-go"
                aria-label="Keep going"
                disabled={busy || !validExtension}
              >
                <svg
                  width="19"
                  height="13"
                  viewBox="0 0 19 13"
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M1 6.5h16M12 1.5l5 5-5 5" />
                </svg>
              </button>
            </div>
          </form>
          <div className="sheet-actions">
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={onBreak}
            >
              Take a break
            </button>
            <button
              type="button"
              className="button-primary"
              disabled={busy}
              onClick={onNewCycle}
            >
              Start a new cycle
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
