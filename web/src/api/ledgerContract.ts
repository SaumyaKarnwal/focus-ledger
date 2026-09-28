import { timestampDate, timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { beforeEach, describe, expect, test } from "vitest";
import { FocusMode } from "../gen/focusledger/v1/model_pb";
import type { LedgerClient } from "./ledgerClient";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The client-layer tests for any LedgerService. `newClient` gives a client
 * for a new user with an empty ledger.
 */
export function describeLedgerContract(
  backendName: string,
  newClient: () => LedgerClient | Promise<LedgerClient>,
) {
  describe(`LedgerService contract (${backendName})`, () => {
    let client: LedgerClient;

    beforeEach(async () => {
      client = await newClient();
    });

    const createNode = async (name: string, parentId?: string) =>
      (await client.createNode({ requestId: newRequestId(), name, parentId }))
        .node!;

    const logEntry = async (startedAt: Date, nodeId?: string) =>
      (
        await client.createCycle({
          requestId: newRequestId(),
          nodeId,
          mode: FocusMode.SHALLOW,
          minutes: 25,
          startedAt: timestampFromDate(startedAt),
        })
      ).cycle!;

    const start = async (nodeId?: string) =>
      (
        await client.createCycle({
          requestId: newRequestId(),
          nodeId,
          mode: FocusMode.DEEP_FOCUS,
          plannedMinutes: 90,
        })
      ).cycle!;

    describe("account and settings", () => {
      test("getAccount_signedIn_returnsAccount", async () => {
        const { account } = await client.getAccount({});

        expect(account?.id).toMatch(UUID);
        expect(account?.email).not.toBe("");
      });

      test("getSettings_newUser_returnsDefaults", async () => {
        const { settings } = await client.getSettings({});

        expect(settings).toMatchObject({
          deepFocusMinutes: 90,
          executionMinutes: 50,
          shallowMinutes: 25,
          breakMinutes: 5,
          soundEnabled: true,
          notificationsEnabled: false,
        });
      });

      test("updateSettings_breakMinutesInMask_changesOnlyThatField", async () => {
        const { settings } = await client.updateSettings({
          settings: { breakMinutes: 10, deepFocusMinutes: 1 },
          updateMask: { paths: ["break_minutes"] },
        });

        expect(settings?.breakMinutes).toBe(10);
        expect(settings?.deepFocusMinutes).toBe(90);
      });

      test("updateSettings_missingMask_invalidArgument", async () => {
        await expectCode(
          client.updateSettings({ settings: { breakMinutes: 10 } }),
          Code.InvalidArgument,
        );
      });

      test("updateSettings_breakMinutesOutOfRange_invalidArgument", async () => {
        await expectCode(
          client.updateSettings({
            settings: { breakMinutes: 61 },
            updateMask: { paths: ["break_minutes"] },
          }),
          Code.InvalidArgument,
        );
      });
    });

    describe("CreateNode", () => {
      test("createNode_newRequestId_returnsNodeWithServerId", async () => {
        const { node } = await client.createNode({
          requestId: newRequestId(),
          name: "  Book  ",
          estimates: [
            { mode: FocusMode.DEEP_FOCUS, cycleMinutes: 90, cycleCount: 5 },
          ],
        });

        expect(node?.id).toMatch(UUID);
        expect(node?.name).toBe("Book");
        expect(node?.closed).toBe(false);
        expect(node?.parentId).toBeUndefined();
        expect(node?.estimates).toMatchObject([
          { mode: FocusMode.DEEP_FOCUS, cycleMinutes: 90, cycleCount: 5 },
        ]);
      });

      test("createNode_repeatedRequestId_returnsSameNode", async () => {
        const request = { requestId: newRequestId(), name: "Book" };

        const first = await client.createNode(request);
        const repeat = await client.createNode(request);

        expect(repeat.node?.id).toBe(first.node?.id);
        expect(await treeNodeIds(client)).toEqual([first.node?.id]);
      });

      test("createNode_sameRequestIdOtherContent_invalidArgument", async () => {
        const requestId = newRequestId();
        await client.createNode({ requestId, name: "Book" });

        await expectCode(
          client.createNode({ requestId, name: "Other" }),
          Code.InvalidArgument,
        );
      });

      test.each(["", "not-a-uuid"])(
        "createNode_requestId%j_invalidArgument",
        async (requestId) => {
          await expectCode(
            client.createNode({ requestId, name: "Book" }),
            Code.InvalidArgument,
          );
        },
      );

      test.each(["", "   ", "x".repeat(201)])(
        "createNode_badName%#_invalidArgument",
        async (name) => {
          await expectCode(
            client.createNode({ requestId: newRequestId(), name }),
            Code.InvalidArgument,
          );
        },
      );

      test("createNode_unknownParent_notFound", async () => {
        await expectCode(
          client.createNode({
            requestId: newRequestId(),
            name: "Chapter",
            parentId: newRequestId(),
          }),
          Code.NotFound,
        );
      });
    });

    describe("UpdateNode", () => {
      test.each([[undefined], [[]], [["name", "color"]]])(
        "updateNode_mask%j_invalidArgument",
        async (paths) => {
          const node = await createNode("Book");

          await expectCode(
            client.updateNode({
              nodeId: node.id,
              name: "Renamed",
              updateMask: paths && { paths },
            }),
            Code.InvalidArgument,
          );
        },
      );

      test("updateNode_unknownId_notFound", async () => {
        await expectCode(
          client.updateNode({
            nodeId: newRequestId(),
            name: "Renamed",
            updateMask: { paths: ["name"] },
          }),
          Code.NotFound,
        );
      });

      test("updateNode_nameAndEstimates_changesBoth", async () => {
        const node = await createNode("Book");

        const { node: updated } = await client.updateNode({
          nodeId: node.id,
          name: "Novel",
          estimates: [
            { mode: FocusMode.EXECUTION, cycleMinutes: 50, cycleCount: 6 },
          ],
          updateMask: { paths: ["name", "estimates"] },
        });

        expect(updated?.name).toBe("Novel");
        expect(updated?.estimates).toMatchObject([
          { mode: FocusMode.EXECUTION, cycleMinutes: 50, cycleCount: 6 },
        ]);
      });

      test("updateNode_moveUnderOwnDescendant_failedPrecondition", async () => {
        const book = await createNode("Book");
        const chapter = await createNode("Chapter", book.id);

        await expectCode(
          client.updateNode({
            nodeId: book.id,
            parentId: chapter.id,
            updateMask: { paths: ["parent_id"] },
          }),
          Code.FailedPrecondition,
        );
        await expectCode(
          client.updateNode({
            nodeId: book.id,
            parentId: book.id,
            updateMask: { paths: ["parent_id"] },
          }),
          Code.FailedPrecondition,
        );
      });

      test("updateNode_parentIdInMaskButUnset_movesToRoot", async () => {
        const book = await createNode("Book");
        const chapter = await createNode("Chapter", book.id);

        const { node } = await client.updateNode({
          nodeId: chapter.id,
          updateMask: { paths: ["parent_id"] },
        });

        expect(node?.parentId).toBeUndefined();
      });

      test("updateNode_moveWithCycles_cyclesMoveWithNode", async () => {
        const book = await createNode("Book");
        const other = await createNode("Other");
        const chapter = await createNode("Chapter", book.id);
        const cycle = await logEntry(
          new Date("2026-10-20T09:00:00Z"),
          chapter.id,
        );

        await client.updateNode({
          nodeId: chapter.id,
          parentId: other.id,
          updateMask: { paths: ["parent_id"] },
        });

        const { nodes } = await client.listNodes({});
        const moved = nodes.find((node) => node.id === chapter.id);
        expect(moved?.parentId).toBe(other.id);
        expect(moved?.cycles.map((c) => c.id)).toEqual([cycle.id]);
      });

      test("updateNode_closed_hidesNodeUnlessIncludeClosed", async () => {
        const node = await createNode("Book");

        await client.updateNode({
          nodeId: node.id,
          closed: true,
          updateMask: { paths: ["closed"] },
        });

        expect(await treeNodeIds(client)).toEqual([]);
        expect(await treeNodeIds(client, true)).toEqual([node.id]);
      });
    });

    describe("CreateCycle", () => {
      test("createCycle_start_returnsRunningCycle", async () => {
        const node = await createNode("Book");

        const cycle = await start(node.id);

        expect(cycle.id).toMatch(UUID);
        expect(cycle.nodeId).toBe(node.id);
        expect(cycle.mode).toBe(FocusMode.DEEP_FOCUS);
        expect(cycle.plannedMinutes).toBe(90);
        expect(cycle.minutes).toBeUndefined();
        expect(cycle.startedAt).toBeDefined();
      });

      test("createCycle_repeatedStart_returnsSameRunningCycle", async () => {
        const request = {
          requestId: newRequestId(),
          mode: FocusMode.EXECUTION,
          plannedMinutes: 50,
        };

        const first = await client.createCycle(request);
        const repeat = await client.createCycle(request);

        expect(repeat.cycle?.id).toBe(first.cycle?.id);
      });

      test("createCycle_secondStartWithNewKey_failedPrecondition", async () => {
        await start();

        await expectCode(
          client.createCycle({
            requestId: newRequestId(),
            mode: FocusMode.SHALLOW,
            plannedMinutes: 25,
          }),
          Code.FailedPrecondition,
        );
      });

      test("createCycle_sameKeyOtherMode_invalidArgument", async () => {
        const requestId = newRequestId();
        await client.createCycle({
          requestId,
          mode: FocusMode.DEEP_FOCUS,
          plannedMinutes: 90,
        });

        await expectCode(
          client.createCycle({
            requestId,
            mode: FocusMode.SHALLOW,
            plannedMinutes: 90,
          }),
          Code.InvalidArgument,
        );
      });

      test("createCycle_handEntry_logsMinutesAsPlanned", async () => {
        const startedAt = new Date("2026-10-30T16:00:00Z");

        const cycle = await logEntry(startedAt);

        expect(cycle.nodeId).toBeUndefined();
        expect(cycle.minutes).toBe(25);
        expect(cycle.plannedMinutes).toBe(25);
        expect(cycle.startedAt && timestampDate(cycle.startedAt)).toEqual(
          startedAt,
        );
      });

      test("createCycle_handEntryWhileRunning_succeeds", async () => {
        await start();

        const entry = await logEntry(new Date("2026-10-30T16:00:00Z"));

        expect(entry.minutes).toBe(25);
      });

      test("createCycle_handEntryWithoutStartedAt_invalidArgument", async () => {
        await expectCode(
          client.createCycle({
            requestId: newRequestId(),
            mode: FocusMode.SHALLOW,
            minutes: 25,
          }),
          Code.InvalidArgument,
        );
      });

      test.each([0, 1441])(
        "createCycle_minutes%i_invalidArgument",
        async (minutes) => {
          await expectCode(
            client.createCycle({
              requestId: newRequestId(),
              mode: FocusMode.SHALLOW,
              minutes,
              startedAt: timestampFromDate(new Date("2026-10-30T16:00:00Z")),
            }),
            Code.InvalidArgument,
          );
        },
      );

      test("createCycle_unspecifiedMode_invalidArgument", async () => {
        await expectCode(
          client.createCycle({
            requestId: newRequestId(),
            mode: FocusMode.UNSPECIFIED,
            plannedMinutes: 25,
          }),
          Code.InvalidArgument,
        );
      });

      test("createCycle_unknownNode_notFound", async () => {
        await expectCode(
          client.createCycle({
            requestId: newRequestId(),
            nodeId: newRequestId(),
            mode: FocusMode.SHALLOW,
            plannedMinutes: 25,
          }),
          Code.NotFound,
        );
      });
    });

    describe("UpdateCycle", () => {
      test("updateCycle_stop_setsMinutesAndAllowsNextStart", async () => {
        const running = await start();

        const { cycle } = await client.updateCycle({
          cycleId: running.id,
          minutes: 1,
          updateMask: { paths: ["minutes"] },
        });

        expect(cycle?.minutes).toBe(1);
        expect((await start()).minutes).toBeUndefined();
      });

      test("updateCycle_extensionAndRepeat_keepLargerTotal", async () => {
        const entry = await logEntry(new Date("2026-10-30T16:00:00Z"));
        const extend = {
          cycleId: entry.id,
          minutes: 40,
          updateMask: { paths: ["minutes"] },
        };

        await client.updateCycle(extend);
        const { cycle } = await client.updateCycle(extend);

        expect(cycle?.minutes).toBe(40);
        expect(cycle?.plannedMinutes).toBe(25);
      });

      test("updateCycle_fewerMinutes_failedPrecondition", async () => {
        const entry = await logEntry(new Date("2026-10-30T16:00:00Z"));

        await expectCode(
          client.updateCycle({
            cycleId: entry.id,
            minutes: 24,
            updateMask: { paths: ["minutes"] },
          }),
          Code.FailedPrecondition,
        );
      });

      test("updateCycle_fileInboxCycle_setsNodeOnce", async () => {
        const book = await createNode("Book");
        const other = await createNode("Other");
        const entry = await logEntry(new Date("2026-10-30T16:00:00Z"));
        const file = (nodeId: string) =>
          client.updateCycle({
            cycleId: entry.id,
            nodeId,
            updateMask: { paths: ["node_id"] },
          });

        const { cycle } = await file(book.id);

        expect(cycle?.nodeId).toBe(book.id);
        await expectCode(file(other.id), Code.FailedPrecondition);
      });

      test("updateCycle_fileToUnknownNode_notFound", async () => {
        const entry = await logEntry(new Date("2026-10-30T16:00:00Z"));

        await expectCode(
          client.updateCycle({
            cycleId: entry.id,
            nodeId: newRequestId(),
            updateMask: { paths: ["node_id"] },
          }),
          Code.NotFound,
        );
      });

      test.each([[undefined], [[]], [["mode"]], [["started_at"]]])(
        "updateCycle_mask%j_invalidArgument",
        async (paths) => {
          const entry = await logEntry(new Date("2026-10-30T16:00:00Z"));

          await expectCode(
            client.updateCycle({
              cycleId: entry.id,
              minutes: 30,
              updateMask: paths && { paths },
            }),
            Code.InvalidArgument,
          );
        },
      );

      test("updateCycle_unknownId_notFound", async () => {
        await expectCode(
          client.updateCycle({
            cycleId: newRequestId(),
            minutes: 30,
            updateMask: { paths: ["minutes"] },
          }),
          Code.NotFound,
        );
      });
    });

    describe("ListNodes", () => {
      test("listNodes_period_returnsCyclesStartedInsideRange", async () => {
        const node = await createNode("Book");
        const before = await logEntry(
          new Date("2026-10-31T23:59:59Z"),
          node.id,
        );
        const atStart = await logEntry(
          new Date("2026-11-01T00:00:00Z"),
          node.id,
        );
        const atEnd = await logEntry(new Date("2026-11-02T00:00:00Z"), node.id);

        const { nodes } = await client.listNodes({
          period: {
            start: timestampFromDate(new Date("2026-11-01T00:00:00Z")),
            end: timestampFromDate(new Date("2026-11-02T00:00:00Z")),
          },
        });

        const cycleIds = nodes
          .find((listed) => listed.id === node.id)
          ?.cycles.map((cycle) => cycle.id);
        expect(cycleIds).toEqual([atStart.id]);
        expect(cycleIds).not.toContain(before.id);
        expect(cycleIds).not.toContain(atEnd.id);
      });

      test("listNodes_inboxCycle_isOnTheNodeWithNoId", async () => {
        const entry = await logEntry(new Date("2026-10-30T16:00:00Z"));

        const { nodes } = await client.listNodes({});

        const inbox = nodes.find((node) => node.id === "");
        expect(inbox?.name).toBe("");
        expect(inbox?.cycles.map((cycle) => cycle.id)).toEqual([entry.id]);
      });

      test("listNodes_children_nestNoCyclesOfDescendants", async () => {
        const book = await createNode("Book");
        const chapter = await createNode("Chapter", book.id);
        await logEntry(new Date("2026-10-30T16:00:00Z"), chapter.id);

        const { nodes } = await client.listNodes({});

        expect(nodes.find((node) => node.id === book.id)?.cycles).toEqual([]);
        expect(nodes.find((node) => node.id === chapter.id)?.parentId).toBe(
          book.id,
        );
      });
    });
  });
}

export function newRequestId(): string {
  return crypto.randomUUID();
}

async function treeNodeIds(client: LedgerClient, includeClosed = false) {
  const { nodes } = await client.listNodes({ includeClosed });
  return nodes.filter((node) => node.id !== "").map((node) => node.id);
}

async function expectCode(call: Promise<unknown>, code: Code) {
  const error = await call.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ConnectError);
  expect(Code[(error as ConnectError).code]).toBe(Code[code]);
}
