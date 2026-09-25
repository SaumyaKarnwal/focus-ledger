# Focus Ledger — API Design (v1, candidate list)

Status: draft. It lists candidate RPCs to keep, discard, or rename. The schema is in [`docs/schema.md`](schema.md).

Stack: Kotlin backend (gRPC), TypeScript web client (gRPC-Web), protobuf contract.

## Architecture

- **The server holds the truth.** Every read, roll-up, and rule runs in the Kotlin backend. The browser renders what the API returns.
- **Sign-in is required in v1.** The schema allows a guest account (`email = NULL`), so a no-wall first run can come later with little change.
- **The database generates every ID.** The client never makes one.

## Conventions

- Package `focusledger.v1`. Service protos hold only the `service` and its `*Request` / `*Response` messages. Entities (`NodePb`, `CyclePb`, …) live in the model proto.
- Every RPC returns its own `*Response` message, even when it carries one entity. Then a field can be added later without a breaking change.
- Names are verb + noun. Standard verbs: `Get`, `List`, `Create`, `Update`. Domain verbs where the action has its own rules: `Move`, `Close`, `Start`, `Stop`.
- Every request is for the signed-in user. No request carries a `user_id`. The server takes it from the session.

## One service: `LedgerService`

All RPCs are in one gRPC service, `LedgerService`, served by one deployment. Nothing in the requirements needs more than one service. The proto groups the RPCs in the sections below. The Kotlin code keeps separate packages for account, ledger rules, and reports. Those are code boundaries, not service boundaries.

Split into more services only when a real trigger appears: a second team, a workload that must scale or fail on its own, or a public API.

## RPCs

12 RPCs in `LedgerService`, grouped by section. Each one earns its place. There is no RPC per screen and no RPC per action.

| Section | RPCs |
|---|---|
| Account | `SignIn`, `SignOut`, `GetAccount` |
| Settings | `GetSettings`, `UpdateSettings` |
| Nodes | `CreateNode`, `UpdateNode`, `GetNode`, `ListNodes` |
| Cycles | `CreateCycle`, `UpdateCycle` |
| Report | `GetReport` |

Every `Update*` request carries a `google.protobuf.FieldMask` that names the fields to change. In proto3, a missing field and a zero value look the same, so the mask is the only way to tell them apart.

### Account

`DeleteAccount` is not in v1. It returns before an iOS release, because Apple's App Store rules require in-app account deletion.

| RPC | Why it is required |
|---|---|
| `SignIn(id_token)` | Checks the Google or Apple ID token, creates or finds the user, and starts a session. |
| `SignOut` | Ends the session. JavaScript cannot clear an HttpOnly session cookie, so the server does it. |
| `GetAccount` | After a page reload, the app must know who is signed in. |

### Settings

| RPC | What it does |
|---|---|
| `GetSettings` | Returns the mode lengths, break length, sound, and notifications. |
| `UpdateSettings` | Changes the fields in the mask. |

### Nodes

A node carries its estimates. There is no estimate RPC.

| RPC | What it does |
|---|---|
| `CreateNode` | Creates a node under a parent or at the root, with optional estimates (FR-1, FR-6, FR-7.2). |
| `UpdateNode` | Changes the fields in the mask: `name`, `parent_id` (move), `closed`, `estimates`. A move under the node's own descendant is rejected (FR-7.8). |
| `GetNode` | Returns one node. |
| `ListNodes` | Returns the user's tree for Today and the Tree screen. |

How the old actions map:

| Action | RPC |
|---|---|
| Rename | `UpdateNode`, mask `name` |
| Move | `UpdateNode`, mask `parent_id` |
| Close, reopen | `UpdateNode`, mask `closed` |
| Save an estimate | `UpdateNode`, mask `estimates` (replaces the three mode rows) |

### Cycles

| RPC | What it does |
|---|---|
| `CreateCycle` | Without `minutes`: starts a cycle (FR-2). A second running cycle is rejected. With `minutes`: writes a hand entry (FR-8). |
| `UpdateCycle` | Changes the fields in the mask: `minutes` (Stop, extension) or `node_id` (filing). |

How the old actions map:

| Action | RPC |
|---|---|
| Start | `CreateCycle`, no `minutes` |
| Hand entry | `CreateCycle`, with `minutes` |
| Stop | `UpdateCycle`, mask `minutes`. A stop under 1 minute sends 1. |
| Extend | `UpdateCycle`, mask `minutes` with the larger total |
| File an Inbox cycle | `UpdateCycle`, mask `node_id` |
| Pause | none. Pause lives in the UI. |

There is no delete. The server rejects a change that breaks the cycle rules: minutes set once and only grow, filing once, mode and start fixed.

### Report

| RPC | What it does |
|---|---|
| `GetReport` | For any period: one row per node, including closed nodes (FR-7.7). Each row has rolled-up minutes, planned minutes and cycle counts per mode, and the estimate. It also returns Inbox time and the grand totals (FR-11). |

`ListNodes` serves the working screens (open nodes, today, this week). `GetReport` serves the Report page (any period, closed nodes, three views).

### Where the old reads went

| Need | Served by |
|---|---|
| *Logged today* for a node (FR-10.4) | `GetNode` / `ListNodes` with `include_cycles` |
| Inbox cycles to file (FR-9.3) | `ListNodesResponse.unfiled` with `include_cycles` |
| The running cycle after a reload (FR-3.5) | `ListNodesResponse.running_cycle` |
| Report views (FR-11.1–11.4) | `GetReport` |

## Decisions

1. **Sign-in: Google only in v1.** `SignIn` takes a Google ID token. Sign in with Apple needs a paid Apple Developer account, so it comes with the iOS app. No magic link.
2. **Node reads carry server-computed stats.** Per mode: own and rolled-up minutes, planned minutes, and cycle count, plus `last_worked_at`. The browser computes nothing.
3. **CSV export (FR-11.6) is not in v1.** When it returns, it is a separate `ExportCycles`.
4. **Retry safety.** `CreateNode` and `CreateCycle` carry a client `request_id`. A repeat returns the first result and creates nothing.
5. **The browser sends periods, not a time zone.** It computes "today", "this week" (starting Monday), and report ranges in its own zone, and sends them as UTC `[start, end)` timestamps. The server needs no time-zone logic.

## Request and response messages

The contract is in [`proto/focusledger/v1/`](../proto/focusledger/v1):
- [`ledger_service.proto`](../proto/focusledger/v1/ledger_service.proto): the service and its `*Request` / `*Response` messages.
- [`model.proto`](../proto/focusledger/v1/model.proto): the shared messages (`NodePb`, `CyclePb`, `EstimatePb`, `ModeStatsPb`, …) and the `FocusMode` enum.

Nullable values use proto3 `optional`, so the server can tell "not set" from zero:
- `CyclePb.minutes` unset means running.
- `CyclePb.node_id` unset means Inbox.
- `NodePb.parent_id` unset means a root.

## Errors

| gRPC status | When |
|---|---|
| `UNAUTHENTICATED` | No valid session. |
| `INVALID_ARGUMENT` | A field is missing or out of range. Examples: an empty name, minutes outside 1–1440, an unknown path in `update_mask`. |
| `NOT_FOUND` | The node or cycle does not exist for this user. Another user's ID also gives `NOT_FOUND`, so the response does not reveal that the ID exists. |
| `FAILED_PRECONDITION` | A rule rejects the change: a second running cycle, minutes that go down, re-filing a filed cycle, a move under the node's own descendant. |
