import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, type Transport } from "@connectrpc/connect";
import { createFakeLedgerTransport } from "../api/fakeLedgerService";
import type { Ledger } from "../api/ledger";
import { createServerLedger } from "../api/serverLedger";
import { NodePbSchema, type NodePb } from "../gen/focusledger/v1/model_pb";
import { exampleNodes } from "../ledger/exampleData";

/** The example nodes without the running cycle. */
export function exampleNodesWithNothingRunning(): NodePb[] {
  return exampleNodes().map((node) =>
    create(NodePbSchema, {
      ...node,
      cycles: node.cycles.filter((cycle) => cycle.minutes !== undefined),
    }),
  );
}

export type RecordingClient = {
  client: Ledger;
  /** The request_id of every CreateCycle call that the client sent. */
  createCycleRequestIds: string[];
  /** The minutes of every UpdateCycle call that the client sent. */
  updateCycleMinutes: (number | undefined)[];
  /** The request_id of every CreateNode call that the client sent. */
  createNodeRequestIds: string[];
  /** The update_mask paths of every UpdateNode and UpdateCycle call that the client sent. */
  updateNodeMasks: string[][];
  updateCycleMasks: string[][];
  /** Drops the response of the next call after the fake handled it. */
  loseNextResponse: () => void;
  /** Fails the next `count` calls of `method` after they are recorded, before they reach the fake. */
  failNext: (method: string, code: Code, count?: number) => void;
  /** Holds the next response of `method` until the returned function runs. */
  holdNext: (method: string) => () => void;
};

export function recordingClient(
  nodes: readonly NodePb[],
  fakeOptions: { signedIn?: boolean } = {},
): RecordingClient {
  const inner = createFakeLedgerTransport({ nodes, ...fakeOptions });
  const createCycleRequestIds: string[] = [];
  const updateCycleMinutes: (number | undefined)[] = [];
  const createNodeRequestIds: string[] = [];
  const updateNodeMasks: string[][] = [];
  const updateCycleMasks: string[][] = [];
  const maskOf = (input: unknown) =>
    (input as { updateMask?: { paths: string[] } }).updateMask?.paths ?? [];
  const failures = new Map<string, { code: Code; count: number }>();
  const holds = new Map<string, Promise<void>>();
  let loseNext = false;

  const transport: Transport = {
    async unary(method, signal, timeoutMs, header, input, contextValues) {
      if (method.name === "CreateCycle") {
        createCycleRequestIds.push((input as { requestId: string }).requestId);
      }
      if (method.name === "UpdateCycle") {
        updateCycleMinutes.push((input as { minutes?: number }).minutes);
        updateCycleMasks.push([...maskOf(input)]);
      }
      if (method.name === "CreateNode") {
        createNodeRequestIds.push((input as { requestId: string }).requestId);
      }
      if (method.name === "UpdateNode") {
        updateNodeMasks.push([...maskOf(input)]);
      }
      const failure = failures.get(method.name);
      if (failure && failure.count > 0) {
        failure.count -= 1;
        throw new ConnectError("the call failed", failure.code);
      }
      const response = await inner.unary(
        method,
        signal,
        timeoutMs,
        header,
        input,
        contextValues,
      );
      const hold = holds.get(method.name);
      if (hold) {
        holds.delete(method.name);
        await hold;
      }
      if (loseNext) {
        loseNext = false;
        throw new ConnectError("the response was lost", Code.Unavailable);
      }
      return response;
    },
    stream: inner.stream,
  };
  return {
    client: createServerLedger(transport),
    createCycleRequestIds,
    updateCycleMinutes,
    createNodeRequestIds,
    updateNodeMasks,
    updateCycleMasks,
    loseNextResponse: () => {
      loseNext = true;
    },
    failNext: (method, code, count = 1) => {
      failures.set(method, { code, count });
    },
    holdNext: (method) => {
      let release = () => {};
      holds.set(
        method,
        new Promise((resolve) => {
          release = resolve;
        }),
      );
      return () => release();
    },
  };
}
