import {
  type FixtureName,
  fixtureNodes,
  selectFixture,
} from "../ledger/fixtures";
import { createFakeLedgerTransport } from "./fakeLedgerService";
import type { GuestLedger, Ledger } from "./ledger";
import { createGuestLedger, indexedDbStore } from "./localLedger";
import { createServerLedger, grpcWebTransport } from "./serverLedger";

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

function fakeOptions(fixture: FixtureName) {
  return {
    nodes: fixtureNodes(fixture, new Date()),
    signedIn: fixture !== "signed-out",
  };
}

let shared: Ledger | undefined;
let sharedGuest: GuestLedger | undefined;

/** The guest's ledger in this browser's IndexedDB (README "Guest mode"). */
export function guestLedger(): GuestLedger {
  sharedGuest ??= createGuestLedger(indexedDbStore());
  return sharedGuest;
}

/** The one ledger that the screens use. */
export function ledger(): Ledger {
  shared ??= createServerLedger(
    selectBackend(
      window.location.search,
      import.meta.env.VITE_LEDGER_BACKEND,
    ) === "fake"
      ? createFakeLedgerTransport(
          fakeOptions(selectFixture(window.location.search)),
        )
      : grpcWebTransport(),
  );
  return shared;
}
