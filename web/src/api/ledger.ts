import type { Client } from "@connectrpc/connect";
import type { LedgerService } from "../gen/focusledger/v1/ledger_service_pb";

/**
 * The one ledger interface the screens use (README "Guest mode"): the
 * LedgerService calls, with their errors as Connect codes. The screens never
 * know which version they talk to.
 */
export type Ledger = Client<typeof LedgerService>;

/** The guest's ledger in this browser, and a way to remove all its data. */
export type GuestLedger = {
  ledger: Ledger;
  clear: () => Promise<void>;
};
