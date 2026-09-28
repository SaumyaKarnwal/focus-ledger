import { create } from "@bufbuild/protobuf";
import {
  type FieldMask,
  type Timestamp,
  timestampDate,
  timestampFromDate,
} from "@bufbuild/protobuf/wkt";
import {
  Code,
  ConnectError,
  createRouterTransport,
  type ServiceImpl,
  type Transport,
} from "@connectrpc/connect";
import { LedgerService } from "../gen/focusledger/v1/ledger_service_pb";
import {
  AccountPbSchema,
  type CyclePb,
  CyclePbSchema,
  type EstimatePb,
  EstimatePbSchema,
  FocusMode,
  type NodePb,
  NodePbSchema,
  type SettingsPb,
  SettingsPbSchema,
} from "../gen/focusledger/v1/model_pb";

export type FakeLedgerOptions = {
  /** The initial rows, in the shape that ListNodes returns. */
  nodes?: readonly NodePb[];
  now?: () => Date;
};

/** A transport that serves an in-memory LedgerService for one signed-in user. */
export function createFakeLedgerTransport(
  options: FakeLedgerOptions = {},
): Transport {
  const fake = createFakeLedgerService(options);
  return createRouterTransport(({ service }) => {
    service(LedgerService, fake);
  });
}

type StoredNode = {
  id: string;
  parentId?: string;
  name: string;
  closed: boolean;
  estimates: EstimatePb[];
  createdAt: Date;
};

type StoredCycle = {
  id: string;
  nodeId?: string;
  mode: FocusMode;
  startedAt: Date;
  plannedMinutes: number;
  minutes?: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME_MAX_LENGTH = 200;
const CYCLE_MINUTES = { min: 1, max: 1440 };
const ESTIMATE_CYCLE_MINUTES = { min: 1, max: 480 };
const MODE_MINUTES = { min: 1, max: 480 };
const BREAK_MINUTES = { min: 1, max: 60 };

const FAKE_ACCOUNT = create(AccountPbSchema, {
  id: "00000000-0000-4000-8000-000000000001",
  email: "fake.user@example.com",
  createdAt: timestampFromDate(new Date("2026-10-01T00:00:00Z")),
});

export function createFakeLedgerService(
  options: FakeLedgerOptions = {},
): ServiceImpl<typeof LedgerService> {
  const now = options.now ?? (() => new Date());
  const seed = options.nodes ?? [];

  const nodes = new Map<string, StoredNode>(
    seed
      .filter((node) => node.id !== "")
      .map((node) => [
        node.id,
        {
          id: node.id,
          parentId: node.parentId,
          name: node.name,
          closed: node.closed,
          estimates: node.estimates,
          createdAt: dateOf(node.createdAt),
        },
      ]),
  );
  const cycles = new Map<string, StoredCycle>(
    seed
      .flatMap((node) => node.cycles)
      .map((cycle) => [
        cycle.id,
        {
          id: cycle.id,
          nodeId: cycle.nodeId,
          mode: cycle.mode,
          startedAt: dateOf(cycle.startedAt),
          plannedMinutes: cycle.plannedMinutes,
          minutes: cycle.minutes,
        },
      ]),
  );
  const nodesByRequest = new Map<string, StoredNode>();
  const cyclesByRequest = new Map<string, StoredCycle>();
  let settings: SettingsPb = create(SettingsPbSchema, {
    deepFocusMinutes: 90,
    executionMinutes: 50,
    shallowMinutes: 25,
    breakMinutes: 5,
    soundEnabled: true,
    notificationsEnabled: false,
  });
  let signedIn = true;

  const requireSession = () => {
    if (!signedIn) throw new ConnectError("no session", Code.Unauthenticated);
  };

  const findNode = (nodeId: string): StoredNode => {
    const node = nodes.get(nodeId);
    if (!node) throw notFound("node");
    return node;
  };

  const findCycle = (cycleId: string): StoredCycle => {
    const cycle = cycles.get(cycleId);
    if (!cycle) throw notFound("cycle");
    return cycle;
  };

  const isSelfOrDescendant = (candidateId: string, nodeId: string) => {
    const ancestors = (id: string | undefined): string[] =>
      id === undefined ? [] : [id, ...ancestors(nodes.get(id)?.parentId)];
    return ancestors(candidateId).includes(nodeId);
  };

  const isClosedOrUnderClosed = (node: StoredNode): boolean => {
    const parent =
      node.parentId === undefined ? undefined : nodes.get(node.parentId);
    return (
      node.closed || (parent !== undefined && isClosedOrUnderClosed(parent))
    );
  };

  const nodeResponse = (node: StoredNode, nodeCycles: CyclePb[] = []): NodePb =>
    create(NodePbSchema, {
      id: node.id,
      parentId: node.parentId,
      name: node.name,
      closed: node.closed,
      estimates: node.estimates,
      cycles: nodeCycles,
      createdAt: timestampFromDate(node.createdAt),
    });

  const ancestorsAndSelf = (nodeId: string | undefined): string[] =>
    nodeId === undefined
      ? []
      : [nodeId, ...ancestorsAndSelf(nodes.get(nodeId)?.parentId)];

  const cyclesOf = (
    nodeId: string | undefined,
    listed: (cycle: StoredCycle) => boolean,
  ) =>
    [...cycles.values()]
      .filter((cycle) => cycle.nodeId === nodeId)
      .filter(listed)
      .sort(
        (left, right) =>
          left.startedAt.getTime() - right.startedAt.getTime() ||
          left.id.localeCompare(right.id),
      )
      .map(cycleResponse);

  return {
    signIn(request) {
      if (
        request.credential.case !== "googleIdToken" ||
        request.credential.value === ""
      ) {
        throw new ConnectError(
          "the token failed the checks",
          Code.Unauthenticated,
        );
      }
      signedIn = true;
      return { account: FAKE_ACCOUNT };
    },

    signOut() {
      signedIn = false;
      return {};
    },

    getAccount() {
      requireSession();
      return { account: FAKE_ACCOUNT };
    },

    getSettings() {
      requireSession();
      return { settings };
    },

    updateSettings(request) {
      requireSession();
      const paths = requireMask(
        request.updateMask,
        Object.keys(SETTINGS_PATHS) as (keyof typeof SETTINGS_PATHS)[],
      );
      const update = request.settings ?? create(SettingsPbSchema);
      const changed = paths.reduce(
        (next, path) => {
          const key = SETTINGS_PATHS[path];
          const value = update[key];
          const range = SETTINGS_RANGES[key];
          if (range && typeof value === "number") {
            requireInRange(value, range, path);
          }
          return { ...next, [key]: value };
        },
        { ...settings },
      );
      settings = create(SettingsPbSchema, changed);
      return { settings };
    },

    createNode(request) {
      requireSession();
      requireRequestId(request.requestId);
      const name = requireName(request.name);
      const estimates = requireEstimates(request.estimates);
      if (request.parentId !== undefined) findNode(request.parentId);

      const existing = nodesByRequest.get(request.requestId);
      if (existing) return { node: nodeResponse(existing) };

      const node: StoredNode = {
        id: crypto.randomUUID(),
        parentId: request.parentId,
        name,
        closed: false,
        estimates,
        createdAt: now(),
      };
      nodes.set(node.id, node);
      nodesByRequest.set(request.requestId, node);
      return { node: nodeResponse(node) };
    },

    updateNode(request) {
      requireSession();
      const paths = requireMask(request.updateMask, [
        "name",
        "parent_id",
        "closed",
        "estimates",
      ]);
      const node = findNode(request.nodeId);
      const changes: Partial<StoredNode> = {};
      if (paths.includes("name")) changes.name = requireName(request.name);
      if (paths.includes("estimates")) {
        changes.estimates = replaceEstimates(
          node.estimates,
          requireEstimates(request.estimates),
        );
      }
      if (paths.includes("closed")) changes.closed = request.closed;
      if (paths.includes("parent_id")) {
        if (request.parentId !== undefined) {
          findNode(request.parentId);
          if (isSelfOrDescendant(request.parentId, node.id)) {
            throw new ConnectError(
              "a node cannot move under itself or its descendant",
              Code.FailedPrecondition,
            );
          }
        }
        changes.parentId = request.parentId;
      }
      Object.assign(node, changes);
      return { node: nodeResponse(node) };
    },

    listNodes(request) {
      requireSession();
      const period = request.period && timeWindow(request.period);
      // The running cycle, its node, and the node's ancestors always come back (api.md).
      const running = [...cycles.values()].find(
        (cycle) => cycle.minutes === undefined,
      );
      const runningPath = new Set(ancestorsAndSelf(running?.nodeId));
      const listed = (cycle: StoredCycle) =>
        cycle === running || !period || period.contains(cycle.startedAt);
      const inbox = create(NodePbSchema, {
        cycles: cyclesOf(undefined, listed),
      });
      const tree = [...nodes.values()]
        .filter(
          (node) =>
            request.includeClosed ||
            !isClosedOrUnderClosed(node) ||
            runningPath.has(node.id),
        )
        .sort(
          (left, right) =>
            left.createdAt.getTime() - right.createdAt.getTime() ||
            left.id.localeCompare(right.id),
        )
        .map((node) => nodeResponse(node, cyclesOf(node.id, listed)));
      return { nodes: [inbox, ...tree] };
    },

    createCycle(request) {
      requireSession();
      requireRequestId(request.requestId);
      requireMode(request.mode);
      if (request.nodeId !== undefined) findNode(request.nodeId);
      const isStart = request.minutes === undefined;
      if (isStart) {
        requireInRange(
          request.plannedMinutes,
          CYCLE_MINUTES,
          "planned_minutes",
        );
      } else {
        requireInRange(request.minutes ?? 0, CYCLE_MINUTES, "minutes");
        if (!request.startedAt) throw invalid("a hand entry needs started_at");
      }
      const plannedMinutes = isStart
        ? request.plannedMinutes
        : (request.minutes ?? 0);

      const existing = cyclesByRequest.get(request.requestId);
      if (existing) {
        const sameCycle =
          existing.mode === request.mode &&
          existing.plannedMinutes === plannedMinutes &&
          (isStart ||
            existing.startedAt.getTime() ===
              dateOf(request.startedAt).getTime());
        if (!sameCycle) {
          throw invalid("request_id was already used for a different request");
        }
        return { cycle: cycleResponse(existing) };
      }
      if (
        isStart &&
        [...cycles.values()].some((c) => c.minutes === undefined)
      ) {
        throw new ConnectError(
          "a cycle is already running",
          Code.FailedPrecondition,
        );
      }

      const cycle: StoredCycle = isStart
        ? {
            id: crypto.randomUUID(),
            nodeId: request.nodeId,
            mode: request.mode,
            startedAt: now(),
            plannedMinutes,
          }
        : {
            id: crypto.randomUUID(),
            nodeId: request.nodeId,
            mode: request.mode,
            startedAt: dateOf(request.startedAt),
            plannedMinutes,
            minutes: request.minutes,
          };
      cycles.set(cycle.id, cycle);
      cyclesByRequest.set(request.requestId, cycle);
      return { cycle: cycleResponse(cycle) };
    },

    updateCycle(request) {
      requireSession();
      const paths = requireMask(request.updateMask, ["minutes", "node_id"]);
      const cycle = findCycle(request.cycleId);
      const changes: Partial<StoredCycle> = {};
      if (paths.includes("minutes")) {
        if (request.minutes === undefined) throw invalid("minutes is required");
        requireInRange(request.minutes, CYCLE_MINUTES, "minutes");
        if (cycle.minutes !== undefined && request.minutes < cycle.minutes) {
          throw new ConnectError(
            "minutes can only grow",
            Code.FailedPrecondition,
          );
        }
        changes.minutes = request.minutes;
      }
      if (paths.includes("node_id")) {
        if (request.nodeId === undefined) throw invalid("node_id is required");
        findNode(request.nodeId);
        if (cycle.nodeId !== undefined && cycle.nodeId !== request.nodeId) {
          throw new ConnectError(
            "the cycle is already filed",
            Code.FailedPrecondition,
          );
        }
        changes.nodeId = request.nodeId;
      }
      Object.assign(cycle, changes);
      return { cycle: cycleResponse(cycle) };
    },
  };
}

type TimeWindow = { contains: (instant: Date) => boolean };

function timeWindow(period: {
  start?: Timestamp;
  end?: Timestamp;
}): TimeWindow {
  const start = period.start
    ? timestampDate(period.start).getTime()
    : -Infinity;
  const end = period.end ? timestampDate(period.end).getTime() : Infinity;
  return {
    contains: (instant) =>
      instant.getTime() >= start && instant.getTime() < end,
  };
}

function cycleResponse(cycle: StoredCycle): CyclePb {
  return create(CyclePbSchema, {
    id: cycle.id,
    nodeId: cycle.nodeId,
    mode: cycle.mode,
    startedAt: timestampFromDate(cycle.startedAt),
    plannedMinutes: cycle.plannedMinutes,
    minutes: cycle.minutes,
  });
}

const SETTINGS_PATHS = {
  deep_focus_minutes: "deepFocusMinutes",
  execution_minutes: "executionMinutes",
  shallow_minutes: "shallowMinutes",
  break_minutes: "breakMinutes",
  sound_enabled: "soundEnabled",
  notifications_enabled: "notificationsEnabled",
} as const satisfies Record<string, keyof SettingsPb>;

const SETTINGS_RANGES: Partial<Record<keyof SettingsPb, Range>> = {
  deepFocusMinutes: MODE_MINUTES,
  executionMinutes: MODE_MINUTES,
  shallowMinutes: MODE_MINUTES,
  breakMinutes: BREAK_MINUTES,
};

type Range = { min: number; max: number };

function requireMask<Path extends string>(
  mask: FieldMask | undefined,
  allowed: readonly Path[],
): Path[] {
  const paths = mask?.paths ?? [];
  if (paths.length === 0) throw invalid("update_mask is required");
  const unknown = paths.filter((path) => !allowed.includes(path as Path));
  if (unknown.length > 0) {
    throw invalid(`unknown path in update_mask: ${unknown.join(", ")}`);
  }
  return paths as Path[];
}

function requireRequestId(requestId: string) {
  if (!UUID.test(requestId)) throw invalid("request_id must be a UUID");
}

function requireName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > NAME_MAX_LENGTH) {
    throw invalid(`name must have 1 to ${NAME_MAX_LENGTH} characters`);
  }
  return trimmed;
}

function requireMode(mode: FocusMode) {
  if (mode === FocusMode.UNSPECIFIED || FocusMode[mode] === undefined) {
    throw invalid("mode is required");
  }
}

function requireEstimates(estimates: EstimatePb[]): EstimatePb[] {
  estimates.forEach((estimate) => {
    requireMode(estimate.mode);
    requireInRange(
      estimate.cycleMinutes,
      ESTIMATE_CYCLE_MINUTES,
      "cycle_minutes",
    );
    if (estimate.cycleCount < 0) throw invalid("cycle_count must be 0 or more");
  });
  const modes = new Set(estimates.map((estimate) => estimate.mode));
  if (modes.size !== estimates.length) {
    throw invalid("each mode can have one estimate");
  }
  return [...estimates].sort((left, right) => left.mode - right.mode);
}

/**
 * The backend never deletes an estimate row. A stored mode that the request
 * leaves out keeps its cycle_minutes, and its cycle_count becomes 0.
 */
function replaceEstimates(
  stored: readonly EstimatePb[],
  requested: EstimatePb[],
): EstimatePb[] {
  const requestedModes = new Set(requested.map((estimate) => estimate.mode));
  const cleared = stored
    .filter((estimate) => !requestedModes.has(estimate.mode))
    .map((estimate) =>
      create(EstimatePbSchema, { ...estimate, cycleCount: 0 }),
    );
  return [...requested, ...cleared].sort(
    (left, right) => left.mode - right.mode,
  );
}

function requireInRange(value: number, range: Range, fieldName: string) {
  if (!Number.isInteger(value) || value < range.min || value > range.max) {
    throw invalid(`${fieldName} must be ${range.min} to ${range.max}`);
  }
}

function dateOf(timestamp: Timestamp | undefined): Date {
  return timestamp ? timestampDate(timestamp) : new Date(0);
}

function invalid(message: string) {
  return new ConnectError(message, Code.InvalidArgument);
}

function notFound(kind: string) {
  return new ConnectError(`${kind} not found`, Code.NotFound);
}
