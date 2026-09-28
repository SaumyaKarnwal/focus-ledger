/**
 * How the sign-in screen gets a Google ID token. The fake backend accepts any
 * token, so it needs no Google script.
 */
export type SignInMethod =
  { kind: "google"; clientId: string | undefined } | { kind: "fake" };

export const FAKE_ID_TOKEN = "fake-google-id-token";
