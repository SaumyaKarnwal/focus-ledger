import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { expect, test } from "vitest";
import { LedgerService } from "./gen/focusledger/v1/ledger_service_pb";
import { CyclePbSchema, FocusMode } from "./gen/focusledger/v1/model_pb";

test("generatedCyclePb_binaryRoundTrip_keepsOptionalFields", () => {
  const running = create(CyclePbSchema, {
    id: "cycle-1",
    mode: FocusMode.DEEP_FOCUS,
    plannedMinutes: 90,
  });

  const decoded = fromBinary(CyclePbSchema, toBinary(CyclePbSchema, running));

  expect(decoded.mode).toBe(FocusMode.DEEP_FOCUS);
  expect(decoded.minutes).toBeUndefined();
  expect(decoded.nodeId).toBeUndefined();
});

test("generatedLedgerService_connectClient_hasEveryRpc", () => {
  const client = createClient(
    LedgerService,
    createConnectTransport({ baseUrl: "http://localhost" }),
  );

  expect(Object.keys(LedgerService.method).sort()).toEqual([
    "createCycle",
    "createNode",
    "getAccount",
    "getSettings",
    "listNodes",
    "signIn",
    "signOut",
    "updateCycle",
    "updateNode",
    "updateSettings",
  ]);
  expect(typeof client.createCycle).toBe("function");
});
