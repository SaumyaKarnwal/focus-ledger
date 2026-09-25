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

This section holds the full proto contract, for review here. The `.proto` files follow in a later PR, after the design is agreed. Package: `focusledger.v1`.

Nullable values use proto3 `optional`, so the server can tell "not set" from zero:
- `CyclePb.minutes` unset means running.
- `CyclePb.node_id` unset means Inbox.
- `NodePb.parent_id` unset means a root.

### The service

```protobuf
// Every RPC acts for the signed-in user from the session. No request carries a user ID.
service LedgerService {
  // Account
  rpc SignIn(SignInRequest) returns (SignInResponse);
  rpc SignOut(SignOutRequest) returns (SignOutResponse);
  rpc GetAccount(GetAccountRequest) returns (GetAccountResponse);

  // Settings
  rpc GetSettings(GetSettingsRequest) returns (GetSettingsResponse);
  rpc UpdateSettings(UpdateSettingsRequest) returns (UpdateSettingsResponse);

  // Nodes
  rpc CreateNode(CreateNodeRequest) returns (CreateNodeResponse);
  rpc UpdateNode(UpdateNodeRequest) returns (UpdateNodeResponse);
  rpc GetNode(GetNodeRequest) returns (GetNodeResponse);
  rpc ListNodes(ListNodesRequest) returns (ListNodesResponse);

  // Cycles
  rpc CreateCycle(CreateCycleRequest) returns (CreateCycleResponse);
  rpc UpdateCycle(UpdateCycleRequest) returns (UpdateCycleResponse);

  // Report
  rpc GetReport(GetReportRequest) returns (GetReportResponse);
}
```

### Shared messages (`model.proto`)

```protobuf
enum FocusMode {
  FOCUS_MODE_UNSPECIFIED = 0;
  FOCUS_MODE_DEEP_FOCUS = 1;
  FOCUS_MODE_EXECUTION = 2;
  FOCUS_MODE_SHALLOW = 3;
}

// A time range [start, end). The browser computes it in the user's zone and sends it in UTC.
message PeriodPb {
  google.protobuf.Timestamp start = 1;
  google.protobuf.Timestamp end = 2;
}

message AccountPb {
  string id = 1;
  string email = 2;
  google.protobuf.Timestamp created_at = 3;
}

message SettingsPb {
  int32 deep_focus_minutes = 1;
  int32 execution_minutes = 2;
  int32 shallow_minutes = 3;
  int32 break_minutes = 4;
  bool sound_enabled = 5;
  bool notifications_enabled = 6;
}

message EstimatePb {
  FocusMode mode = 1;
  int32 cycle_minutes = 2;
  int32 cycle_count = 3;
}

message ModeStatsPb {
  FocusMode mode = 1;
  int32 minutes = 2;
  int32 planned_minutes = 3;
  int32 cycle_count = 4;
}

message NodeStatsPb {
  repeated ModeStatsPb own = 1;
  // Own plus all descendants.
  repeated ModeStatsPb rolled_up = 2;
  // Start of the most recent cycle on this node, across all time. Unset if the node has no cycles.
  google.protobuf.Timestamp last_worked_at = 3;
}

message CyclePb {
  string id = 1;
  // Unset means the cycle is in the Inbox.
  optional string node_id = 2;
  FocusMode mode = 3;
  google.protobuf.Timestamp started_at = 4;
  int32 planned_minutes = 5;
  // Unset means the cycle is running.
  optional int32 minutes = 6;
}

message NodePb {
  string id = 1;
  // Unset means a root node.
  optional string parent_id = 2;
  string name = 3;
  bool closed = 4;
  repeated EstimatePb estimates = 5;
  NodeStatsPb stats = 6;
  // Filled only when the request asks for cycles.
  repeated CyclePb cycles = 7;
  google.protobuf.Timestamp created_at = 8;
}

message UnfiledPb {
  // Stats for Inbox cycles, over the same range as the node stats.
  repeated ModeStatsPb stats = 1;
  int32 cycle_count = 2;
  // Filled only when the request asks for unfiled cycles.
  repeated CyclePb cycles = 3;
}
```

### Account messages

#### `SignIn`

```protobuf
message SignInRequest {
  string google_id_token = 1;
}

// The session is set as an HttpOnly cookie, not returned in the body.
message SignInResponse {
  AccountPb account = 1;
}
```

#### `SignOut`

```protobuf
message SignOutRequest {}

message SignOutResponse {}
```

#### `GetAccount`

```protobuf
message GetAccountRequest {}

message GetAccountResponse {
  AccountPb account = 1;
}
```

### Settings messages

#### `GetSettings`

```protobuf
message GetSettingsRequest {}

message GetSettingsResponse {
  SettingsPb settings = 1;
}
```

#### `UpdateSettings`

```protobuf
message UpdateSettingsRequest {
  SettingsPb settings = 1;
  google.protobuf.FieldMask update_mask = 2;
}

message UpdateSettingsResponse {
  SettingsPb settings = 1;
}
```

### Nodes messages

#### `CreateNode`

```protobuf
message CreateNodeRequest {
  // A repeat of the same request_id returns the first result and creates nothing.
  string request_id = 1;
  optional string parent_id = 2;
  string name = 3;
  repeated EstimatePb estimates = 4;
}

message CreateNodeResponse {
  NodePb node = 1;
}
```

#### `UpdateNode`

```protobuf
// Paths in update_mask: "name", "parent_id", "closed", "estimates".
// "parent_id" in the mask with parent_id unset moves the node to the root.
// "estimates" replaces all of the node's estimate rows.
message UpdateNodeRequest {
  string node_id = 1;
  optional string parent_id = 2;
  string name = 3;
  bool closed = 4;
  repeated EstimatePb estimates = 5;
  google.protobuf.FieldMask update_mask = 6;
}

message UpdateNodeResponse {
  NodePb node = 1;
}
```

#### `GetNode`

```protobuf
message GetNodeRequest {
  string node_id = 1;
  // When set, the node carries its cycles that started at or after this time.
  google.protobuf.Timestamp cycles_since = 2;
}

message GetNodeResponse {
  NodePb node = 1;
}
```

#### `ListNodes`

```protobuf
// Returns the whole tree in one response, with no pagination: roll-ups need every node.
// Node stats cover all time.
message ListNodesRequest {
  bool include_closed = 1;
  // When set, every node carries its cycles that started at or after this time.
  google.protobuf.Timestamp cycles_since = 2;
  bool include_unfiled_cycles = 3;
  PeriodPb today = 4;
  PeriodPb week = 5;
}

message ListNodesResponse {
  repeated NodePb nodes = 1;
  UnfiledPb unfiled = 2;
  // Unset when no cycle is running.
  CyclePb running_cycle = 3;
  // Totals per mode over all cycles, filed and unfiled.
  repeated ModeStatsPb today_totals = 4;
  repeated ModeStatsPb week_totals = 5;
}
```

### Cycles messages

#### `CreateCycle`

```protobuf
// Without minutes: starts a cycle now. The server rejects a second running cycle.
// With minutes and started_at: writes a hand entry.
message CreateCycleRequest {
  // A repeat of the same request_id returns the first result and creates nothing.
  string request_id = 1;
  optional string node_id = 2;
  FocusMode mode = 3;
  int32 planned_minutes = 4;
  google.protobuf.Timestamp started_at = 5;
  optional int32 minutes = 6;
}

message CreateCycleResponse {
  CyclePb cycle = 1;
}
```

#### `UpdateCycle`

```protobuf
// Paths in update_mask: "minutes" (Stop or extension; minutes can only grow)
// and "node_id" (filing an Inbox cycle, once).
message UpdateCycleRequest {
  string cycle_id = 1;
  optional int32 minutes = 2;
  optional string node_id = 3;
  google.protobuf.FieldMask update_mask = 4;
}

message UpdateCycleResponse {
  CyclePb cycle = 1;
}
```

### Report messages

#### `GetReport`

```protobuf
message GetReportRequest {
  PeriodPb period = 1;
}

// Includes closed nodes. Node stats cover the request period.
message GetReportResponse {
  repeated NodePb nodes = 1;
  UnfiledPb unfiled = 2;
  // Grand totals per mode, filed and unfiled.
  repeated ModeStatsPb totals = 3;
}
```

## Errors

| gRPC status | When |
|---|---|
| `UNAUTHENTICATED` | No valid session. |
| `INVALID_ARGUMENT` | A field is missing or out of range. Examples: an empty name, minutes outside 1–1440, an unknown path in `update_mask`. |
| `NOT_FOUND` | The node or cycle does not exist for this user. Another user's ID also gives `NOT_FOUND`, so the response does not reveal that the ID exists. |
| `FAILED_PRECONDITION` | A rule rejects the change: a second running cycle, minutes that go down, re-filing a filed cycle, a move under the node's own descendant. |
