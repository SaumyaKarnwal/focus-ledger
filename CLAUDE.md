# Focus Ledger

A personal time ledger. Every work cycle records its node (what you worked on) and its mode (Deep Focus, Execution, or Shallow). The report is a node × mode cross-tab.

## Read these first

| Doc | Holds |
|---|---|
| [`docs/prd.md`](docs/prd.md) | The product requirements |
| [`docs/schema.md`](docs/schema.md) | The tables, the cycle rules, and the PRD changes |
| [`docs/api.md`](docs/api.md) | `LedgerService`, the proto contract, sessions, user isolation, errors |
| [`docs/architecture.md`](docs/architecture.md) | The components, backend layers, key flows, hosting |
| [`docs/mcp.md`](docs/mcp.md) | The MCP server, tools, and agent sign-in |
| [`docs/setup.md`](docs/setup.md) | Environments, Postgres roles, secrets, module layout |
| [`docs/execution-plan.md`](docs/execution-plan.md) | Phases, workstreams, and how sessions work together |

If code and a doc disagree, stop and ask on the issue with the `needs-design` label. Do not pick one yourself.

## Stack

- Backend: Kotlin, one program. Armeria serves gRPC, gRPC-Web, and static files. Ktor hosts the MCP server. No Spring, no BFF.
- Data: Postgres 17, jOOQ, Flyway, HikariCP. Neon in production.
- Web: React + TypeScript, the generated TypeScript client for `LedgerService`.
- Hosting: Cloud Run, Neon, Cloudflare. CI: GitHub Actions.

## Layout

```
proto/          the .proto contract
backend/core    rules and services, no framework imports
backend/data    jOOQ repositories, Flyway migrations
backend/api-grpc, backend/api-mcp, backend/app
web/            the web app
site/           public pages
```

## Commands

To be filled in by Phase 0. Every worker runs the setup commands first, because a fresh worktree has no `node_modules` and no generated code.

## Rules the code must never break

1. **The user comes from the session or the token, never from a request field.**
2. **Every query filters by that `user_id`.** Never read or write a row by `id` alone.
3. **Another user's ID returns `NOT_FOUND`.** Each RPC has a test for this.
4. **A cycle allows exactly three changes:** Stop sets `minutes` once, an extension adds minutes (never fewer), and filing sets `node_id` once on an Inbox cycle. Mode, start, and planned minutes never change.
5. **Nothing is deleted.** The runtime database role has no `DELETE`.
6. **All times are UTC.** The server has no time-zone logic. The browser sends UTC ranges, and MCP tools take a `time_zone`.
7. **Every `Update*` request needs an `update_mask`.** A missing or empty mask returns `INVALID_ARGUMENT`.
8. **The browser computes roll-ups.** The gRPC API returns rows. Only the MCP layer computes summaries on the server.
9. **No secrets in files, commits, or logs.**

## Contracts

`proto/`, `V1__init.sql` and later migrations, and the interfaces in `backend/core` are contracts. A worker session never changes them. Open a `needs-design` question on the issue instead.

## Workflow

- One issue per task, one branch and one PR per task. Branch names: `skarnwal_<short-description>`.
- Every PR deploys on its own.
- Every PR that changes behavior includes tests: unit tests for rules, integration tests against a real Postgres, and a user-isolation test for every RPC and MCP tool. The orchestrator does not merge a behavior change without them.
- Push after each commit.
- Run the module checks and the formatter before every push.
- Do not merge a test that fails even once in repeated runs.
- Never deploy without asking the owner.
- The PR description states what was verified and how. Say "I read this but did not run it" when that is the case.

## Writing

- Prose (docs, PR descriptions, commit messages, comments) follows ASD-STE100 Simplified Technical English: short sentences, active voice, one topic per sentence.
- Diagrams use Mermaid, never ASCII art.
- Default to no code comment. Write one only for a reason the code cannot show, in one or two plain lines.
- Kotlin: functional collection operations over `for` loops, descriptive names, no backticks on names that do not need them.
- Proto: every RPC returns its own `*Response` message. Entity messages live in `model.proto`.

## Sessions

See "Orchestration" in `docs/execution-plan.md`. In short: the `design` session owns `docs/`, the `orchestrator` merges PRs once CI is green and tests are present, and each worker (`ws-a` … `ws-e`) builds one workstream in its own worktree. A worker with a design question messages `design` and labels its issue `needs-design`.
