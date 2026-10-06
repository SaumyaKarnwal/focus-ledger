import { create, fromJson, type JsonValue, toJson } from "@bufbuild/protobuf";
import {
  createClient,
  createRouterTransport,
  type HandlerContext,
  type ServiceImpl,
} from "@connectrpc/connect";
import { LedgerService } from "../gen/focusledger/v1/ledger_service_pb";
import {
  EstimatePbSchema,
  SettingsPbSchema,
} from "../gen/focusledger/v1/model_pb";
import type { Ledger } from "./ledger";
import {
  createLedgerRules,
  DEFAULT_SETTINGS,
  type LedgerState,
  seedState,
  type StoredCycle,
  type StoredNode,
} from "./ledgerRules";

/** The rows of a guest ledger as plain data, for storage. */
export type LedgerSnapshot = {
  version: 1;
  nodes: (Omit<StoredNode, "estimates" | "createdAt"> & {
    estimates: JsonValue[];
    createdAt: number;
  })[];
  cycles: (Omit<StoredCycle, "startedAt"> & { startedAt: number })[];
  /** request_id → node ID, so a retry after a reload finds its row. */
  nodeRequests: [string, string][];
  cycleRequests: [string, string][];
  settings: JsonValue;
};

/** Where a guest ledger keeps its snapshot. */
export type LedgerStore = {
  load: () => Promise<LedgerSnapshot | undefined>;
  save: (snapshot: LedgerSnapshot) => Promise<void>;
  clear: () => Promise<void>;
};

export function toSnapshot(state: LedgerState): LedgerSnapshot {
  return {
    version: 1,
    nodes: [...state.nodes.values()].map((node) => ({
      ...node,
      estimates: node.estimates.map((estimate) =>
        toJson(EstimatePbSchema, estimate),
      ),
      createdAt: node.createdAt.getTime(),
    })),
    cycles: [...state.cycles.values()].map((cycle) => ({
      ...cycle,
      startedAt: cycle.startedAt.getTime(),
    })),
    nodeRequests: [...state.nodesByRequest].map(([requestId, node]) => [
      requestId,
      node.id,
    ]),
    cycleRequests: [...state.cyclesByRequest].map(([requestId, cycle]) => [
      requestId,
      cycle.id,
    ]),
    settings: toJson(SettingsPbSchema, state.settings),
  };
}

export function fromSnapshot(snapshot: LedgerSnapshot): LedgerState {
  const nodes = new Map<string, StoredNode>(
    snapshot.nodes.map((node) => [
      node.id,
      {
        ...node,
        estimates: node.estimates.map((estimate) =>
          fromJson(EstimatePbSchema, estimate),
        ),
        createdAt: new Date(node.createdAt),
      },
    ]),
  );
  const cycles = new Map<string, StoredCycle>(
    snapshot.cycles.map((cycle) => [
      cycle.id,
      { ...cycle, startedAt: new Date(cycle.startedAt) },
    ]),
  );
  const rows = <Row>(pairs: [string, string][], byId: Map<string, Row>) =>
    new Map(
      pairs.flatMap(([requestId, id]) => {
        const row = byId.get(id);
        return row ? [[requestId, row] as const] : [];
      }),
    );
  return {
    nodes,
    cycles,
    nodesByRequest: rows(snapshot.nodeRequests, nodes),
    cyclesByRequest: rows(snapshot.cycleRequests, cycles),
    settings: create(SettingsPbSchema, {
      ...DEFAULT_SETTINGS,
      ...fromJson(SettingsPbSchema, snapshot.settings),
    }),
  };
}

/** A store in memory: for tests, and the guest ledger's shape without a browser. */
export function memoryStore(): LedgerStore {
  let saved: LedgerSnapshot | undefined;
  return {
    load: async () => saved && structuredClone(saved),
    save: async (snapshot) => {
      saved = structuredClone(snapshot);
    },
    clear: async () => {
      saved = undefined;
    },
  };
}

const STORE = "ledger";
const KEY = "snapshot";

/** The guest's snapshot in this browser's IndexedDB. */
export function indexedDbStore(name = "focus-ledger-guest"): LedgerStore {
  const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  const run = async <Result>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest,
  ) => {
    const database = await open();
    try {
      return await new Promise<Result>((resolve, reject) => {
        const transaction = database.transaction(STORE, mode);
        const request = action(transaction.objectStore(STORE));
        transaction.oncomplete = () => resolve(request.result as Result);
        transaction.onerror = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  };
  return {
    load: () =>
      run<LedgerSnapshot | undefined>("readonly", (store) => store.get(KEY)),
    save: async (snapshot) => {
      await run("readwrite", (store) => store.put(snapshot, KEY));
    },
    clear: async () => {
      await run("readwrite", (store) => store.delete(KEY));
    },
  };
}

/**
 * The guest's ledger (README "Guest mode"): the server's rules over rows that
 * stay in this browser. Nothing reaches the server. Every write saves the
 * whole snapshot, so two tabs on one guest ledger overwrite each other.
 */
export function createLocalLedger(
  store: LedgerStore,
  options: { now?: () => Date } = {},
): Ledger {
  const ready = store.load().then((snapshot) => {
    const state = snapshot ? fromSnapshot(snapshot) : seedState();
    return {
      state,
      rules: createLedgerRules(state, { guest: true, now: options.now }),
    };
  });
  type Rules = ServiceImpl<typeof LedgerService>;
  const read =
    <Name extends keyof Rules>(name: Name) =>
    async (request: never, context: HandlerContext) => {
      const { rules } = await ready;
      const handler = rules[name] as (
        request: never,
        context: HandlerContext,
      ) => unknown;
      return handler(request, context);
    };
  const write =
    <Name extends keyof Rules>(name: Name) =>
    async (request: never, context: HandlerContext) => {
      const { state } = await ready;
      const response = await read(name)(request, context);
      await store.save(toSnapshot(state));
      return response;
    };
  const service = {
    signIn: read("signIn"),
    signOut: read("signOut"),
    getAccount: read("getAccount"),
    getSettings: read("getSettings"),
    updateSettings: write("updateSettings"),
    createNode: write("createNode"),
    updateNode: write("updateNode"),
    listNodes: read("listNodes"),
    createCycle: write("createCycle"),
    updateCycle: write("updateCycle"),
  } as unknown as Rules;
  return createClient(
    LedgerService,
    createRouterTransport(({ service: serve }) => {
      serve(LedgerService, service);
    }),
  );
}
