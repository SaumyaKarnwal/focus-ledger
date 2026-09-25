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

## Candidate RPCs

### AccountService

| RPC | What it does | PRD |
|---|---|---|
| `StartSignIn` | Sends a sign-in link or code to an email. | FR-12 |
| `CompleteSignIn` | Exchanges the code for a session. | FR-12 |
| `SignOut` | Ends the session. | FR-12 |
| `GetAccount` | Returns email and created date. | FR-12 |
| `DeleteAccount` | Deletes the account and all its data. | FR-12 AC |

The shape of `StartSignIn` / `CompleteSignIn` depends on the sign-in method (magic link, OAuth, or password). That is still open.

Later, for guest accounts: `CreateGuestAccount` makes an `app_user` with `email = NULL`, and `CompleteSignIn` attaches an email to it.

### SettingsService

| RPC | What it does | PRD |
|---|---|---|
| `GetSettings` | Returns the mode lengths, break length, sound, notifications. | FR-12.1 |
| `UpdateSettings` | Changes one or more settings. | FR-12.2 |

### NodeService

| RPC | What it does | PRD |
|---|---|---|
| `CreateNode` | Creates a node under a parent, or at the root. | FR-1, FR-7.2 |
| `RenameNode` | Changes the name. | FR-7 |
| `MoveNode` | Changes the parent. Rejects a move under its own descendant. | FR-7.3, FR-7.8 |
| `CloseNode` | Closes a node. | FR-7.7 |
| `ReopenNode` | Reopens a closed node. | FR-7 AC |
| `ListNodes` | Returns the user's whole tree (about 100 rows). | FR-7 |
| `GetMoveImpact` | Returns "39 cycles · 28h 10m will move with it". | FR-7.6 |

Candidates to discard or merge:
- `CloseNode` + `ReopenNode` → one `SetNodeClosed(node_id, closed)`.
- `RenameNode` → a general `UpdateNode` with a field mask. Specific verbs are clearer while the node has one editable field.
- `GetMoveImpact` → a field on the response of a node read.

### EstimateService

| RPC | What it does | PRD |
|---|---|---|
| `SetEstimate` | Replaces a node's three mode rows in one call (Save in the editor). | FR-6 |
| `GetEstimate` | Returns a node's estimate rows. | FR-6 |

Candidate to merge: put both on `NodeService`, because an estimate always belongs to one node.

### CycleService

| RPC | What it does | PRD |
|---|---|---|
| `StartCycle` | Writes the row with `minutes = NULL`. Rejects a second running cycle. | FR-2 |
| `StopCycle` | Sets `minutes` to the elapsed time. | FR-3, FR-4.1 |
| `CancelCycle` | Removes a running cycle (Stop under 1 minute). | FR-3 |
| `ExtendCycle` | Adds minutes to a logged cycle ("Keep going for 15"). | FR-4.6 |
| `GetRunningCycle` | Returns the running cycle, so a reopened tab can resume. | FR-3.5 |
| `LogCycle` | Writes a hand entry in one step. | FR-8 |
| `FileCycle` | Sets `node_id` on an Inbox cycle. | FR-9.4 |
| `ListCycles` | Returns cycles for a day, a node, or the Inbox. | FR-8, FR-9, FR-10 |

Pause has no RPC. It lives in the UI (decided in the schema).

### Screen reads (ViewService)

One call returns everything that one screen needs.

| RPC | What it returns | PRD |
|---|---|---|
| `GetToday` | The rail (open nodes, last worked, `done of est`), today's and this week's totals by mode. | FR-10 |
| `GetTree` | All nodes with rolled-up cycles and estimates. | FR-7 |
| `GetReport` | The node × mode cross-tab for a period. | FR-11.1–11.3 |
| `GetEstimateReport` | Estimated vs logged per node. | FR-11.4 |
| `GetPlannedVsActual` | Planned vs actual minutes per mode (the new analysis). | schema decision 5 |
| `ExportCycles` | CSV of raw cycles. | FR-11.6 |

Every read takes the browser time zone, for "today", "this week", and day groups.

## Open questions

1. The sign-in method: magic link, OAuth (Google, Apple), or password?
2. Service granularity: one service per resource, as above, or one `FocusLedgerService`?
3. The merge candidates: `SetNodeClosed`, estimates on `NodeService`, `GetMoveImpact` as a field.
4. Retry safety. The server makes the IDs, so a retried `LogCycle` could write two rows. `StartCycle` is safe, because a user can have only one running cycle. The proposal: each write request carries a client `request_id`, and the server ignores a repeat.
