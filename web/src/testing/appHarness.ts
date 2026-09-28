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
  /** Drops the response of the next call after the fake handled it. */
  loseNextResponse: () => void;
};

export function recordingClient(nodes: readonly NodePb[]): RecordingClient {
  const inner = createFakeLedgerTransport({ nodes });
  const createCycleRequestIds: string[] = [];
  let loseNext = false;
  const transport: Transport = {
    async unary(method, signal, timeoutMs, header, input, contextValues) {
      if (method.name === "CreateCycle") {
        createCycleRequestIds.push((input as { requestId: string }).requestId);
      }
      const response = await inner.unary(
        method,
        signal,
        timeoutMs,
        header,
        input,
        contextValues,
      );
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
    loseNextResponse: () => {
      loseNext = true;
    },
  };
}
