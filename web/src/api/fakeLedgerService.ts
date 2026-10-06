import {
  createRouterTransport,
  type ServiceImpl,
  type Transport,
} from "@connectrpc/connect";
import { LedgerService } from "../gen/focusledger/v1/ledger_service_pb";
import type { NodePb } from "../gen/focusledger/v1/model_pb";
import { createLedgerRules, seedState } from "./ledgerRules";

export type FakeLedgerOptions = {
  /** The initial rows, in the shape that ListNodes returns. */
  nodes?: readonly NodePb[];
  now?: () => Date;
  /** False starts with no session, so every call but SignIn is UNAUTHENTICATED. */
  signedIn?: boolean;
};

/** A transport that serves an in-memory LedgerService for one signed-in user. */
export function createFakeLedgerTransport(
  options: FakeLedgerOptions = {},
): Transport {
  const fake = createFakeLedgerService(options);
  return createRouterTransport(({ service }) => {
    service(LedgerService, fake);
  });
}

/** The server's rules over rows kept in memory, for tests and `?backend=fake`. */
export function createFakeLedgerService(
  options: FakeLedgerOptions = {},
): ServiceImpl<typeof LedgerService> {
  return createLedgerRules(seedState(options.nodes), {
    now: options.now,
    signedIn: options.signedIn,
  });
}
