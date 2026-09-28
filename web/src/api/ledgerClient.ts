import { type Client, createClient, type Transport } from "@connectrpc/connect";
import { createGrpcWebTransport } from "@connectrpc/connect-web";
import { LedgerService } from "../gen/focusledger/v1/ledger_service_pb";
import {
  type FixtureName,
  fixtureNodes,
  selectFixture,
} from "../ledger/fixtures";
import { createFakeLedgerTransport } from "./fakeLedgerService";

export type LedgerClient = Client<typeof LedgerService>;

export type Backend = "real" | "fake";

/**
 * `?backend=fake` in the page URL selects the fake. Otherwise the build flag
 * `VITE_LEDGER_BACKEND=fake` selects it.
 */
export function selectBackend(
  search: string,
  buildFlag: string | undefined,
): Backend {
  const fromUrl = new URLSearchParams(search).get("backend");
  if (fromUrl === "fake" || fromUrl === "real") return fromUrl;
  return buildFlag === "fake" ? "fake" : "real";
}

export function createLedgerTransport(backend: Backend): Transport {
  return backend === "fake"
    ? createFakeLedgerTransport(
        fakeOptions(selectFixture(window.location.search)),
      )
    : createGrpcWebTransport({ baseUrl: window.location.origin });
}

function fakeOptions(fixture: FixtureName) {
  return {
    nodes: fixtureNodes(fixture, new Date()),
    signedIn: fixture !== "signed-out",
  };
}

export function createLedgerClient(transport: Transport): LedgerClient {
  return createClient(LedgerService, transport);
}

let sharedClient: LedgerClient | undefined;

/** The one client that the screens use. */
export function ledgerClient(): LedgerClient {
  sharedClient ??= createLedgerClient(
    createLedgerTransport(
      selectBackend(
        window.location.search,
        import.meta.env.VITE_LEDGER_BACKEND,
      ),
    ),
  );
  return sharedClient;
}
