import type { ReactNode } from "react";
import { useNow } from "../useNow";
import { ScreenHeader } from "./ScreenHeader";

type Props = {
  /** deep, execution, shallow, or break: sets the screen color through data-mode. */
  modeKey: string;
  timeZone: string;
  email: string;
  /** Without it, Tasks in the header is inert, as while a cycle runs. */
  onOpenTasks?: () => void;
  onSignOut: () => void;
  /** The middle of the screen: the modes on the left, the clock on the right. */
  children: ReactNode;
  strip: ReactNode;
  /** A dialog over the screen, such as the bell. */
  overlay?: ReactNode;
  /** True when a dialog covers the screen: the screen takes no input. */
  inert?: boolean;
};

/** The shared layout of the mode screens (boards C-Desk-Start, -Run, -Break2). */
export function ModeScreenFrame({
  modeKey,
  timeZone,
  email,
  onOpenTasks,
  onSignOut,
  children,
  strip,
  overlay,
  inert = false,
}: Props) {
  const now = useNow();
  return (
    <div className="mode-screen" data-mode={modeKey}>
      <div className="mode-screen-glow" aria-hidden="true" />
      <div
        className="mode-screen-body"
        inert={inert}
        aria-hidden={inert || undefined}
      >
        <ScreenHeader
          now={now}
          timeZone={timeZone}
          email={email}
          onOpenTasks={onOpenTasks}
          onSignOut={onSignOut}
        />
        <div className="start-main">{children}</div>
        <footer className="task-strip">{strip}</footer>
      </div>
      {overlay}
    </div>
  );
}

/** A mode name on a plate, not a control (the mode of a running cycle never changes). */
export function ModePlate({ label, name }: { label: string; name: string }) {
  return (
    <div className="start-modes">
      <span className="screen-label start-modes-label">{label}</span>
      <div className="start-mode start-mode-plate">
        <span className="start-mode-bar" aria-hidden="true" />
        <span className="start-mode-name">{name}</span>
      </div>
    </div>
  );
}

/** The big clock with an optional progress bar under it. */
export function ScreenClock({
  label,
  text,
  progress,
  note,
}: {
  label: string;
  text: string;
  /** From 0 to 1. Without it, no bar is drawn. */
  progress?: number;
  note?: ReactNode;
}) {
  return (
    <div className="screen-clock">
      <p className="start-time" role="timer" aria-label={label}>
        {text}
      </p>
      {progress !== undefined && (
        <div
          className="screen-progress"
          role="progressbar"
          aria-label="Progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
        >
          <span
            style={{ width: `${Math.min(1, Math.max(0, progress)) * 100}%` }}
          />
        </div>
      )}
      {note}
    </div>
  );
}

/** "Working on Name path", without the chevron: the task is bound. */
export function BoundTask({
  label = "Working on",
  name,
  detail,
}: {
  label?: string;
  name: string;
  detail?: string;
}) {
  return (
    <span className="task-strip-task">
      <span className="screen-label">{label}</span>
      <span className="task-strip-name">{name}</span>
      {detail && <span className="task-strip-path">{detail}</span>}
    </span>
  );
}
