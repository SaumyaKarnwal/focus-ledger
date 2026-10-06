/**
 * Whether this browser was signed in (README "Guest mode", #275). It holds no
 * data and no email. With it, a session that ends says so in place of
 * dropping into guest mode.
 */
const KEY = "focus-ledger.had-account";

export function hadAccount(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setHadAccount(value: boolean): void {
  try {
    if (value) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    // Without storage, a session that ends opens guest mode.
  }
}
