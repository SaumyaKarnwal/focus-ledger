import { useEffect, useRef, useState } from "react";
import { PageHeader } from "../ui/PageHeader";
import { renderGoogleButton } from "./googleIdentity";
import { FAKE_ID_TOKEN, type SignInMethod } from "./signInMethod";

type Props = {
  method: SignInMethod;
  busy: boolean;
  error: string | undefined;
  onIdToken: (idToken: string) => void;
};

/** Sign-in is required and uses Google only (docs/prd.md, FR-1.7 as changed). */
export function SignInScreen({ method, busy, error, onIdToken }: Props) {
  return (
    <>
      <PageHeader />
      <div className="sign-in">
        <div className="sign-in-story">
          <h2 className="title sign-in-title">Keep the ledger with you.</h2>
          <p className="sign-in-lead">
            Sign in to keep every cycle, estimate, and report in one ledger. It
            is the same on every machine you work from.
          </p>
          <ul className="sign-in-points">
            <li>
              <CheckIcon />
              The same ledger on every machine you work from.
            </li>
            <li>
              <CheckIcon />
              History that outlives this browser, which is what makes the
              estimate model worth anything.
            </li>
            <li>
              <CrossIcon />
              Nothing is locked behind it. Every feature is the same for every
              account.
            </li>
          </ul>
        </div>
        <section className="sign-in-card" aria-labelledby="sign-in-heading">
          <h2 id="sign-in-heading" className="title title-m">
            Sign in
          </h2>
          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          {method.kind === "fake" ? (
            <button
              type="button"
              className="button-primary sign-in-button"
              disabled={busy}
              onClick={() => onIdToken(FAKE_ID_TOKEN)}
            >
              Sign in with Google
            </button>
          ) : (
            <GoogleButton clientId={method.clientId} onIdToken={onIdToken} />
          )}
          <p className="note">
            A new email makes a new account. An email you have used before opens
            that account.
          </p>
        </section>
      </div>
      <p className="note sign-in-foot">
        We store your email and your cycles. No tracking, and no email you did
        not ask for.
      </p>
    </>
  );
}

function GoogleButton({
  clientId,
  onIdToken,
}: {
  clientId: string | undefined;
  onIdToken: (idToken: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const callback = useRef(onIdToken);
  const [loadError, setLoadError] = useState<string>();

  useEffect(() => {
    callback.current = onIdToken;
  }, [onIdToken]);

  useEffect(() => {
    if (!clientId || !container.current) return;
    renderGoogleButton(container.current, clientId, (token) =>
      callback.current(token),
    ).catch((reason: unknown) => setLoadError(String(reason)));
  }, [clientId]);

  if (!clientId) {
    return (
      <p className="alert" role="alert">
        Sign-in is not set up: GOOGLE_CLIENT_ID is missing from the build.
      </p>
    );
  }
  return (
    <>
      {loadError && (
        <p className="alert" role="alert">
          {loadError}
        </p>
      )}
      <div ref={container} className="google-button" />
    </>
  );
}

function CheckIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M3 8.4l3 3L13 4.6" />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 16 16"
      fill="none"
      stroke="var(--faint)"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}
