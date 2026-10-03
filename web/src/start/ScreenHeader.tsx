import { useState } from "react";
import { formatDayLabel } from "../ledger/period";
import { PRODUCT_NAME } from "../productName";

type Props = {
  now: Date;
  timeZone: string;
  email: string;
  onOpenTasks: () => void;
  onSignOut: () => void;
};

/**
 * The header of the mode screens. Report and Settings have no v2 board yet,
 * so they are shown but do nothing (browser-v2 README).
 */
export function ScreenHeader({
  now,
  timeZone,
  email,
  onOpenTasks,
  onSignOut,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <header className="screen-header">
      <span className="screen-brand">
        <h1 className="screen-brand-name">{PRODUCT_NAME}</h1>
        <span className="screen-label">{formatDayLabel(now, timeZone)}</span>
      </span>
      <nav className="screen-nav" aria-label="Views">
        <span
          className="screen-nav-item"
          aria-disabled="true"
          title="Not in this version yet"
        >
          Report
        </span>
        <button type="button" className="screen-nav-item" onClick={onOpenTasks}>
          Tasks
        </button>
        <span
          className="screen-nav-item"
          aria-disabled="true"
          title="Not in this version yet"
        >
          Settings
        </span>
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
