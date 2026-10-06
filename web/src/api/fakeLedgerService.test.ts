import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, test } from "vitest";
import { FocusMode } from "../gen/focusledger/v1/model_pb";
import { exampleNodes, exampleNow } from "../ledger/exampleData";
import { overallTotals, runningCycle } from "../ledger/rollup";
import { createFakeLedgerTransport } from "./fakeLedgerService";
import { describeLedgerContract } from "./ledgerContract";
import { newRequestId } from "./requestId";
import { createServerLedger } from "./serverLedger";

describeLedgerContract("fake", () =>
  createServerLedger(createFakeLedgerTransport()),
);

describe("fake LedgerService", () => {
  const seededClient = () =>
    createServerLedger(
      createFakeLedgerTransport({
        nodes: exampleNodes(),
        now: () => exampleNow,
      }),
    );

  test("listNodes_seededWithExample_returnsTheExampleRows", async () => {
    const { nodes } = await seededClient().listNodes({ includeClosed: true });

    expect(overallTotals(nodes)).toEqual(overallTotals(exampleNodes()));
    expect(runningCycle(nodes)?.id).toBe(runningCycle(exampleNodes())?.id);
  });

  test("listNodes_seededWithoutIncludeClosed_leavesOutClosedNode", async () => {
    const { nodes } = await seededClient().listNodes({});

    expect(nodes.map((node) => node.name)).toEqual([
      "",
      "Book",
      "Chapter 1",
      "Notes",
      "Admin",
    ]);
  });

  test("createCycle_startWhileSeededCycleRuns_failedPrecondition", async () => {
    const error = await seededClient()
      .createCycle({
        requestId: newRequestId(),
        mode: FocusMode.SHALLOW,
        plannedMinutes: 25,
      })
      .catch((reason: unknown) => reason);

    expect(ConnectError.from(error).code).toBe(Code.FailedPrecondition);
  });

  test("createCycle_start_usesTheInjectedClock", async () => {
    const client = createServerLedger(
      createFakeLedgerTransport({ now: () => exampleNow }),
    );

    const { cycle } = await client.createCycle({
      requestId: newRequestId(),
      mode: FocusMode.SHALLOW,
      plannedMinutes: 25,
    });

    expect(cycle?.startedAt?.seconds).toBe(BigInt(exampleNow.getTime() / 1000));
  });

  test("signOut_thenGetAccount_unauthenticated", async () => {
    const client = seededClient();

    await client.signOut({});
    const error = await client
      .getAccount({})
      .catch((reason: unknown) => reason);

    expect(ConnectError.from(error).code).toBe(Code.Unauthenticated);
  });

  test("signIn_withToken_restoresTheSession", async () => {
    const client = seededClient();
    await client.signOut({});

    await client.signIn({
      credential: { case: "googleIdToken", value: "test-id-token" },
    });

    expect((await client.getAccount({})).account?.email).not.toBe("");
  });
});
