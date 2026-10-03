import { useEffect, useRef, useState } from "react";
import type { LoggedMode } from "../ledger/rollup";
import {
  BoundTask,
  ModePlate,
  ModeScreenFrame,
  ScreenClock,
} from "../start/ModeScreenFrame";
import { MODE_NAMES } from "../today/todayModel";
import { useNow } from "../useNow";
import { loadLocalSettings } from "../settings/localSettings";
import { formatCountdown } from "./timer";

const MINUTE_MS = 60_000;
const EXTRA_BREAK_MINUTES = 5;
const LENGTH_STEP = 5;
const LENGTH_MIN = 5;
const LENGTH_MAX = 120;

type BreakKind = "short" | "long";
const BREAK_NAMES: Record<BreakKind, string> = {
  short: "Short break",
  long: "Long break",
};

/** The cycle to come back to after the break. */
export type ComingBackTo = {
  mode: LoggedMode;
  /** Undefined for the Inbox. */
  taskName?: string;
  path: string[];
  /** The task to show on Start after the break, or undefined for the default task. */
  nodeId?: string;
};

type Props = {
  comingBackTo: ComingBackTo;
  /** The short break length from the settings. */
  breakMinutes: number;
  email: string;
  timeZone: string;
  onDone: () => void;
  onSignOut: () => void;
};

/** The break (boards C-Desk-Break2 and -Break2-Long). A break is not written to the ledger (FR-5). */
export function BreakScreen({
  comingBackTo,
  breakMinutes,
  email,
  timeZone,
  onDone,
  onSignOut,
}: Props) {
  const now = useNow();
  const [kind, setKind] = useState<BreakKind>("short");
  const [totalMinutes, setTotalMinutes] = useState(breakMinutes);
  const [startedAt, setStartedAt] = useState<number>();
  const totalMs = totalMinutes * MINUTE_MS;
  const elapsedMs =
    startedAt === undefined
      ? 0
      : Math.min(totalMs, Math.max(0, now.getTime() - startedAt));
  const remaining = totalMs - elapsedMs;
  const doneHandled = useRef(false);

  useEffect(() => {
    if (startedAt !== undefined && remaining === 0 && !doneHandled.current) {
      doneHandled.current = true;
      onDone();
    }
  }, [startedAt, remaining, onDone]);

  const chooseKind = (next: BreakKind) => {
    setKind(next);
    setTotalMinutes(
      next === "short" ? breakMinutes : loadLocalSettings().longBreakMinutes,
    );
  };
  const step = (by: number) =>
    setTotalMinutes((current) =>
      Math.min(LENGTH_MAX, Math.max(LENGTH_MIN, current + by)),
    );

  const backTo = comingBackTo.taskName
    ? [comingBackTo.taskName, comingBackTo.path.join(" / ")]
        .filter((part) => part !== "")
        .join(" · ")
    : "Not sure yet";

  return (
    <ModeScreenFrame
      modeKey="break"
      timeZone={timeZone}
      email={email}
      onSignOut={onSignOut}
      strip={
        <BoundTask
          label="Coming back to"
          name={MODE_NAMES[comingBackTo.mode]}
          detail={backTo}
        />
      }
    >
      {startedAt === undefined ? (
        <>
          <section className="start-modes" aria-labelledby="break-kind">
            <h2 id="break-kind" className="screen-label start-modes-label">
              What kind of break
            </h2>
            <div
              className="start-mode-list"
              role="radiogroup"
              aria-labelledby="break-kind"
            >
              {(["short", "long"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={kind === option}
                  className="start-mode"
                  onClick={() => chooseKind(option)}
                >
                  <span className="start-mode-bar" aria-hidden="true" />
                  <span className="start-mode-name">{BREAK_NAMES[option]}</span>
                </button>
              ))}
            </div>
          </section>
          <section className="start-clock" aria-label="Break length">
            <div className="start-stepper">
              <button
                type="button"
                className="start-step"
                aria-label="Shorter break"
                onClick={() => step(-LENGTH_STEP)}
              >
                −
              </button>
              <output className="start-time" aria-label="Break length">
                {formatCountdown(totalMs)}
              </output>
              <button
                type="button"
                className="start-step"
                aria-label="Longer break"
                onClick={() => step(LENGTH_STEP)}
              >
                +
              </button>
            </div>
            <div className="start-actions">
              <button
                type="button"
                className="screen-cta"
                aria-label="Start the break"
                onClick={() => setStartedAt(now.getTime())}
              >
                START
              </button>
              <button
                type="button"
                className="screen-outline screen-outline-soft"
                onClick={onDone}
              >
                Start a cycle
              </button>
            </div>
          </section>
        </>
      ) : (
        <>
          <ModePlate label="On a break" name={BREAK_NAMES[kind]} />
          <section className="start-clock" aria-label="Break">
            <ScreenClock
              label="Break time left"
              text={formatCountdown(remaining)}
              progress={elapsedMs / totalMs}
              note={
                <p className="screen-note">
                  {Math.floor(elapsedMs / MINUTE_MS)} of {totalMinutes} min.
                  Breaks are not logged.
                </p>
              }
            />
            <div className="start-actions">
              <button
                type="button"
                className="screen-outline"
                onClick={() =>
                  setTotalMinutes((minutes) => minutes + EXTRA_BREAK_MINUTES)
                }
              >
                +5 min
              </button>
              <button
                type="button"
                className="screen-outline screen-outline-soft"
                onClick={onDone}
              >
                Start a cycle
              </button>
            </div>
          </section>
        </>
      )}
    </ModeScreenFrame>
  );
}
