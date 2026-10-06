import { createClient, type Transport } from "@connectrpc/connect";
import { createGrpcWebTransport } from "@connectrpc/connect-web";
import { LedgerService } from "../gen/focusledger/v1/ledger_service_pb";
import type { Ledger } from "./ledger";

/** The server version of the ledger: LedgerService over a transport. */
export function createServerLedger(transport: Transport): Ledger {
  return createClient(LedgerService, transport);
}

/** gRPC-Web to the backend that served the page. */
export function grpcWebTransport(): Transport {
  return createGrpcWebTransport({ baseUrl: window.location.origin });
}
