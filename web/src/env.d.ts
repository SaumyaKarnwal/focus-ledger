interface ImportMetaEnv {
  readonly VITE_LEDGER_BACKEND?: "fake" | "real";
  /** Public. From GOOGLE_CLIENT_ID in the repository .env or the build environment. */
  readonly GOOGLE_CLIENT_ID?: string;
}
