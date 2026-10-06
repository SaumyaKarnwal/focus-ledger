import { createContext } from "react";

/**
 * Set while the app runs as a guest (README "Guest mode"): the header then
 * shows a "Sign in" pill in place of the account initial.
 */
export const GuestContext = createContext<{ onSignIn: () => void } | undefined>(
  undefined,
);
