/** The part of Google Identity Services that the sign-in button uses. */
type GoogleIdentity = {
  accounts: {
    id: {
      initialize: (config: {
        client_id: string;
        callback: (response: { credential: string }) => void;
      }) => void;
      renderButton: (
        parent: HTMLElement,
        options: Record<string, string | number>,
      ) => void;
    };
  };
};

declare global {
  interface Window {
    google?: GoogleIdentity;
  }
}

const SCRIPT_URL = "https://accounts.google.com/gsi/client";

let loading: Promise<GoogleIdentity> | undefined;

function loadGoogleIdentity(): Promise<GoogleIdentity> {
  loading ??= new Promise((resolve, reject) => {
    if (window.google) {
      resolve(window.google);
      return;
    }
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () =>
      window.google
        ? resolve(window.google)
        : reject(new Error("Google sign-in did not load"));
    script.onerror = () => {
      loading = undefined;
      reject(new Error("Google sign-in did not load"));
    };
    document.head.append(script);
  });
  return loading;
}

/**
 * Draws Google's sign-in button in `parent`. `onCredential` gets the ID token
 * that SignIn sends to the backend.
 */
export async function renderGoogleButton(
  parent: HTMLElement,
  clientId: string,
  onCredential: (idToken: string) => void,
): Promise<void> {
  const google = await loadGoogleIdentity();
  google.accounts.id.initialize({
    client_id: clientId,
    callback: (response) => onCredential(response.credential),
  });
  google.accounts.id.renderButton(parent, {
    type: "standard",
    theme: "filled_black",
    size: "large",
    shape: "rectangular",
    text: "signin_with",
    width: 358,
  });
}
