import { createPortal } from "react-dom";

/**
 * Asks once before Sign out (board A-Signout). It renders into the body: the
 * header is a container, and a container would hold a fixed dialog inside it.
 */
export function SignOutConfirm({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
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
        aria-labelledby="signout-heading"
        aria-describedby="signout-text"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      >
        <h2 id="signout-heading" className="signout-heading">
          Sign out?
        </h2>
        <p id="signout-text" className="signout-text">
          Everything is saved to your account, and it will all be there when you
          sign back in. This device stops keeping a copy.
        </p>
        <div className="signout-actions">
          <button
            type="button"
            className="signout-cancel"
            autoFocus
            onClick={onCancel}
          >
            Cancel
          </button>
          <button type="button" className="signout-confirm" onClick={onConfirm}>
            Sign out
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
