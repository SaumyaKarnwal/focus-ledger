import { createPortal } from "react-dom";

/**
 * Asks once before a guest with history signs in (README "Guest mode"): the
 * guest data stays out of the account, and a sign-in removes it.
 */
export function SignInWarning({
  onCancel,
  onSignIn,
}: {
  onCancel: () => void;
  onSignIn: () => void;
}) {
  return createPortal(
    <div
      className="signout-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        className="signout"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="sign-in-warning-heading"
        aria-describedby="sign-in-warning-text"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      >
        <h2 id="sign-in-warning-heading" className="signout-heading">
          Sign in?
        </h2>
        <p id="sign-in-warning-text" className="signout-text">
          Your guest history stays out of your account. Signing in removes it
          from this browser.
        </p>
        <div className="signout-actions">
          <button
            type="button"
            className="cancel-button"
            autoFocus
            onClick={onCancel}
          >
            Cancel
          </button>
          <button type="button" className="signout-confirm" onClick={onSignIn}>
            Sign in
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
