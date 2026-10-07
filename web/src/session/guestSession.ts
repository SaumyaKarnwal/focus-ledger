import { createContext } from "react";

/**
 * Set while the app runs as a guest (README "Guest mode"): the header then
 * shows a "Sign in" pill in place of the account initial.
 */
export const GuestContext = createContext<{ onSignIn: () => void } | undefined>(
  undefined,
);

/**
 * Set while a session that ended waits for the user (#283): Google's chooser
 * could not show, so the header shows a "Sign in again" pill.
 */
export const ReauthContext = createContext<
  { onSignInAgain: () => void; onKeepGoing: () => void } | undefined
>(undefined);
