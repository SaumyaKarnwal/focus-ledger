import { useEffect, useRef, useState } from "react";
import {
  PRODUCT_NAME,
  PRODUCT_NAME_MEANING,
  PRODUCT_NAME_NATIVE,
} from "../productName";
import { renderGoogleButton } from "./googleIdentity";
import { FAKE_ID_TOKEN, type SignInMethod } from "./signInMethod";

type Props = {
  method: SignInMethod;
  busy: boolean;
  error: string | undefined;
  onIdToken: (idToken: string) => void;
};

/**
 * Sign-in is required and uses Google only (docs/prd.md, FR-1.7 as changed).
 * The playful screen of board A-Signin-OnePoint. A guest mode is a later decision,
 * so the board's "keep going without an account" link is not built.
 */
export function SignInScreen({ method, busy, error, onIdToken }: Props) {
  return (
    <main className="sign-in">
      <h1 className="visually-hidden">Sign in</h1>
      <section className="sign-in-card" aria-label={PRODUCT_NAME}>
        <div className="sign-in-name">
          <span className="sign-in-native" lang="sa">
            {PRODUCT_NAME_NATIVE}
          </span>
          <h2 className="sign-in-brand">{PRODUCT_NAME}</h2>
          <span className="sign-in-meaning">{PRODUCT_NAME_MEANING}</span>
        </div>
        <p className="sign-in-lead">
          A clock that asks one thing before it starts: what kind of focus is
          this? Sign in and every cycle you name follows you to any device.
        </p>
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        {method.kind === "fake" ? (
          <button
            type="button"
            className="sign-in-button"
            disabled={busy}
            onClick={() => onIdToken(FAKE_ID_TOKEN)}
          >
            Continue with Google
          </button>
        ) : (
          <GoogleButton clientId={method.clientId} onIdToken={onIdToken} />
        )}
      </section>
    </main>
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
        Sign-in is not set up: the server sent no GOOGLE_CLIENT_ID.
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
