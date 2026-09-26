# Focus Ledger

The brand name is **not final** (the working choice is Ekagra; see `docs/architecture.md`, "Name and domain"). User-facing text reads the product name from **one constant**, so a rename is a one-line change. `focus-ledger` stays the internal name in code, protos, database roles, and cloud resources.

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
- Data: Postgres 18, jOOQ, Flyway, HikariCP. Neon in production.
- Web: React + TypeScript, the generated TypeScript client for `LedgerService`.
- Hosting: Cloud Run, Neon, Cloudflare. CI: GitHub Actions.

## Layout

```
proto/          the .proto contract
backend/core    rules and services, no framework imports
backend/data    jOOQ repositories, Flyway migrations
backend/api-grpc, backend/api-mcp, backend/app
web/            the web app
site/           public pages (later)
infra/          deploy setup (later, ws-c)
```

## Commands

Every worker runs the setup commands first, because a fresh worktree has no `node_modules` and no generated code. Run them from the worktree root.

Setup:

```bash
docker compose up -d --wait                 # local Postgres 18 with the roles and schemas
(cd web && corepack pnpm install)           # Corepack reads the pnpm version from web/package.json
```

Check (run before every push):

```bash
./gradlew build spotlessCheck
(cd web && corepack pnpm test && corepack pnpm lint && corepack pnpm build)
```

Format:

```bash
./gradlew spotlessApply
(cd web && corepack pnpm format)
```

After `corepack enable`, plain `pnpm` works in place of `corepack pnpm`. Two worktrees cannot run `docker compose up` at the same time, because both bind port 5432.

## Rules the code must never break

1. **The user comes from the session or the token, never from a request field.**
2. **Every query filters by that `user_id`.** Never read or write a row by `id` alone.
3. **Another user's ID returns `NOT_FOUND`.** Each RPC has a test for this.
4. **A cycle allows exactly three changes:** Stop sets `minutes` once, an extension adds minutes (never fewer), and filing sets `node_id` once on an Inbox cycle. Mode, start, and planned minutes never change.
5. **Nothing is deleted.** The runtime database role has no `DELETE`.
6. **All times are UTC.** The server has no time-zone logic. The browser sends UTC ranges, and MCP tools take a `time_zone`.
7. **Every `Update*` request needs an `update_mask`.** A missing or empty mask returns `INVALID_ARGUMENT`.
8. **The browser computes roll-ups.** The gRPC API returns rows. Only the MCP layer computes summaries on the server.
9. **Every create is idempotent.** `CreateNode` and `CreateCycle` require a `request_id`. Insert with `ON CONFLICT (user_id, request_id) DO NOTHING`, and return the existing row on a repeat.
10. **Never commit a secret or a token, anywhere.** A secret is a password, an API key, a token, a private key, a signing key, or a connection string with a password in it.
    - Not in code, config, tests, docs, commit messages, PR descriptions, issue comments, or logs.
    - Secrets live only in Google Secret Manager (production) or in a local `.env` file that git ignores. `.env.example` lists the variable names with fake values only.
    - Tests use obviously fake values (for example `test-signing-key`) or keys generated during the test run.
    - CI runs `gitleaks` on every PR. A finding fails the build, and the orchestrator does not merge it.
    - If a secret is ever committed, treat it as leaked: rotate it first, then remove it from history.

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

**Start every session with `/ledger-session`.** The skill finds this session's role from its name (`design`, `orchestrator`, `ws-a` … `ws-e`) and loads that role's playbook and the message protocol. Start a session with its name, for example `claude --name orchestrator`, or set it with `/rename`.

See "Orchestration" in `docs/execution-plan.md`. In short: the `design` session owns `docs/`, the `orchestrator` starts a part only after a `START` from `design` or the owner, and merges PRs automatically once CI is green, the tests are present, and an intense code review passes, and each worker (`ws-a` … `ws-e`) builds one workstream in its own worktree. A worker with a design question messages `design` and labels its issue `needs-design`.
