import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, test } from "vitest";
import { FocusMode } from "../gen/focusledger/v1/model_pb";
import { describeLedgerContract } from "./ledgerContract";
import { createLocalLedger, memoryStore } from "./localLedger";
import { newRequestId } from "./requestId";

describeLedgerContract("local", () => createLocalLedger(memoryStore()), {
  guest: true,
});

describe("local ledger (README Guest mode)", () => {
  test("localLedger_reload_keepsNodesCyclesAndSettings", async () => {
    const store = memoryStore();
    const first = createLocalLedger(store);
    const { node } = await first.createNode({
      requestId: newRequestId(),
      name: "Book",
    });
    await first.createCycle({
      requestId: newRequestId(),
      nodeId: node?.id,
      mode: FocusMode.SHALLOW,
      minutes: 25,
      startedAt: timestampFromDate(new Date("2026-11-01T09:00:00Z")),
    });
    await first.updateSettings({
      settings: { breakMinutes: 7 },
      updateMask: { paths: ["break_minutes"] },
    });

    // A reload: a new ledger on the same store.
    const second = createLocalLedger(store);
    const { nodes } = await second.listNodes({ includeClosed: true });
    const book = nodes.find((listed) => listed.name === "Book");

    expect(book?.id).toBe(node?.id);
    expect(book?.cycles.map((cycle) => cycle.minutes)).toEqual([25]);
    expect((await second.getSettings({})).settings?.breakMinutes).toBe(7);
  });

  test("localLedger_retryAfterAReload_returnsTheSameRow", async () => {
    const store = memoryStore();
    const requestId = newRequestId();
    const { node } = await createLocalLedger(store).createNode({
      requestId,
      name: "Book",
    });

    const repeat = await createLocalLedger(store).createNode({
      requestId,
      name: "Book",
    });

    expect(repeat.node?.id).toBe(node?.id);
  });

  test("localLedger_runningCycle_survivesAReload_andStopsOnce", async () => {
    const store = memoryStore();
    const { cycle } = await createLocalLedger(store).createCycle({
      requestId: newRequestId(),
      mode: FocusMode.DEEP_FOCUS,
      plannedMinutes: 90,
    });
    const reloaded = createLocalLedger(store);

    await reloaded.updateCycle({
      cycleId: cycle?.id ?? "",
      minutes: 30,
      updateMask: { paths: ["minutes"] },
    });

    const error = await reloaded
      .updateCycle({
        cycleId: cycle?.id ?? "",
        minutes: 10,
        updateMask: { paths: ["minutes"] },
      })
      .then(
        () => undefined,
        (reason: unknown) => ConnectError.from(reason),
      );
    expect(error?.code).toBe(Code.FailedPrecondition);
  });

  test("localLedger_guest_isOpenAndHasNoSignIn", async () => {
    const ledger = createLocalLedger(memoryStore());

    await ledger.signOut({});
    expect((await ledger.getAccount({})).account?.email).toBe("");
    const error = await ledger
      .signIn({ credential: { case: "googleIdToken", value: "token" } })
      .then(
        () => undefined,
        (reason: unknown) => ConnectError.from(reason),
      );
    expect(error?.code).toBe(Code.Unimplemented);
  });

  test("localLedger_clear_leavesAnEmptyLedger", async () => {
    const store = memoryStore();
    await createLocalLedger(store).createNode({
      requestId: newRequestId(),
      name: "Book",
    });

    await store.clear();

    const { nodes } = await createLocalLedger(store).listNodes({});
    expect(nodes.map((node) => node.name)).toEqual([""]);
  });
});
