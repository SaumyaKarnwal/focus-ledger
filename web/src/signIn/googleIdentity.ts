/**
 * What the prompt reports. With FedCM, Google keeps only the skipped and
 * dismissed moments, so the others are optional.
 */
export type PromptMoment = {
  isNotDisplayed?: () => boolean;
  isSkippedMoment?: () => boolean;
  isDismissedMoment?: () => boolean;
  getDismissedReason?: () => string;
};

/** The part of Google Identity Services that the app uses. */
export type GoogleIdentity = {
  accounts: {
    id: {
      initialize: (config: {
        client_id: string;
        callback: (response: { credential: string }) => void;
        auto_select?: boolean;
      }) => void;
      renderButton: (
        parent: HTMLElement,
        options: Record<string, string | number>,
      ) => void;
      prompt: (onMoment?: (moment: PromptMoment) => void) => void;
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
  // A library already on the page wins, for example a test's fake.
  if (window.google) return Promise.resolve(window.google);
  loading ??= new Promise((resolve, reject) => {
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
    shape: "pill",
    text: "continue_with",
    width: 300,
  });
}

/**
 * Shows Google's account chooser over the current screen (One Tap), for a
 * session that ended (#283). auto_select stays off, so the user picks the
 * account. `onNotShown` runs when Google skips the prompt, the user closes
 * it, or the library does not load.
 */
export async function promptGoogleSignIn(
  clientId: string,
  onCredential: (idToken: string) => void,
  onNotShown: () => void,
): Promise<void> {
  let google: GoogleIdentity;
  try {
    google = await loadGoogleIdentity();
  } catch {
    onNotShown();
    return;
  }
  google.accounts.id.initialize({
    client_id: clientId,
    callback: (response) => onCredential(response.credential),
    auto_select: false,
  });
  google.accounts.id.prompt((moment) => {
    const dismissedWithoutAccount =
      moment.isDismissedMoment?.() === true &&
      moment.getDismissedReason?.() !== "credential_returned";
    if (
      moment.isNotDisplayed?.() === true ||
      moment.isSkippedMoment?.() === true ||
      dismissedWithoutAccount
    ) {
      onNotShown();
    }
  });
}
