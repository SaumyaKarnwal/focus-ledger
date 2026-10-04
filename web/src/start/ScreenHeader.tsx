import { useState } from "react";
import { formatDayLabel } from "../ledger/period";
import { PRODUCT_NAME } from "../productName";
import type { TimerChip } from "../session/sessionTimer";

type Props = {
  now: Date;
  timeZone: string;
  email: string;
  /** Without it, Tasks is shown but does nothing, as while a cycle runs. */
  onOpenTasks?: () => void;
  /** Report opens only from the Tasks page until it has a v2 page. */
  onOpenReport?: () => void;
  onOpenSettings?: () => void;
  /** The brand goes to Start, or back to the cycle while one runs. */
  onOpenHome?: () => void;
  /** What the brand says it does, after the product name. */
  homeLabel?: string;
  /** The time left of the cycle or break that runs while this page shows. */
  timer?: TimerChip;
  /** The view this header sits on. */
  current?: "tasks" | "settings";
  onSignOut: () => void;
};

/**
 * The header of the mode screens and of the light pages. Report has no v2
 * page yet, so only the Tasks page links it (browser-v2 README).
 */
export function ScreenHeader({
  now,
  timeZone,
  email,
  onOpenTasks,
  onOpenReport,
  onOpenSettings,
  current,
  onOpenHome,
  homeLabel = "back to Start",
  timer,
  onSignOut,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <header className="screen-header">
      <span className="screen-brand">
        <h1 className="screen-brand-name">
          {onOpenHome ? (
            <button
              type="button"
              className="screen-home"
              aria-label={`${PRODUCT_NAME}, ${homeLabel}`}
              onClick={onOpenHome}
            >
              {PRODUCT_NAME}
            </button>
          ) : (
            PRODUCT_NAME
          )}
        </h1>
        <span className="screen-label">{formatDayLabel(now, timeZone)}</span>
      </span>
      <nav className="screen-nav" aria-label="Views">
        {timer && (
          <button
            type="button"
            className="screen-timer"
            data-mode={timer.modeKey}
            onClick={timer.onOpen}
          >
            <span className="screen-timer-mark" aria-hidden="true" />
            {timer.label}
            <span className="screen-timer-time">{timer.text}</span>
          </button>
        )}
        <NavItem label="Report" onOpen={onOpenReport} />
        <NavItem
          label="Tasks"
          onOpen={onOpenTasks}
          current={current === "tasks"}
        />
        <NavItem
          label="Settings"
          onOpen={onOpenSettings}
          current={current === "settings"}
        />
        <span className="screen-account">
          <button
            type="button"
            className="screen-badge"
            aria-label="Your account"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {(email[0] ?? "?").toUpperCase()}
          </button>
          {menuOpen && (
            <span className="screen-menu" role="menu">
              <span className="screen-menu-email">{email}</span>
              <button type="button" role="menuitem" onClick={onSignOut}>
                Sign out
              </button>
            </span>
          )}
        </span>
      </nav>
    </header>
  );
}

function NavItem({
  label,
  onOpen,
  current = false,
}: {
  label: string;
  onOpen?: () => void;
  current?: boolean;
}) {
  return onOpen ? (
    <button
      type="button"
      className="screen-nav-item"
      aria-current={current ? "page" : undefined}
      onClick={onOpen}
    >
      {label}
    </button>
  ) : (
    <span
      className="screen-nav-item"
      aria-disabled="true"
      aria-current={current ? "page" : undefined}
    >
      {label}
    </span>
  );
}
