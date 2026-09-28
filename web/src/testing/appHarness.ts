import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, type Transport } from "@connectrpc/connect";
import { createFakeLedgerTransport } from "../api/fakeLedgerService";
import { createLedgerClient, type LedgerClient } from "../api/ledgerClient";
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
  client: LedgerClient;
  /** The request_id of every CreateCycle call that reached the fake. */
  createCycleRequestIds: string[];
  /** The minutes of every UpdateCycle call that reached the fake. */
  updateCycleMinutes: (number | undefined)[];
  /** Drops the response of the next call after the fake handled it. */
  loseNextResponse: () => void;
  /** Fails the next `count` calls of `method` before they reach the fake. */
  failNext: (method: string, code: Code, count?: number) => void;
  /** Holds the next response of `method` until the returned function runs. */
  holdNext: (method: string) => () => void;
};

export function recordingClient(nodes: readonly NodePb[]): RecordingClient {
  const inner = createFakeLedgerTransport({ nodes });
  const createCycleRequestIds: string[] = [];
  const updateCycleMinutes: (number | undefined)[] = [];
  const failures = new Map<string, { code: Code; count: number }>();
  const holds = new Map<string, Promise<void>>();
  let loseNext = false;

  const transport: Transport = {
    async unary(method, signal, timeoutMs, header, input, contextValues) {
      const failure = failures.get(method.name);
      if (failure && failure.count > 0) {
        failure.count -= 1;
        throw new ConnectError("the call failed", failure.code);
      }
      if (method.name === "CreateCycle") {
        createCycleRequestIds.push((input as { requestId: string }).requestId);
      }
      if (method.name === "UpdateCycle") {
        updateCycleMinutes.push((input as { minutes?: number }).minutes);
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
    client: createLedgerClient(transport),
    createCycleRequestIds,
    updateCycleMinutes,
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
