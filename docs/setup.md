# Focus Ledger — Database and Backend Setup (v1)

Status: draft for review. Everything in this doc is **proposed** until approved. The architecture is in [`architecture.md`](architecture.md). The execution plan is in [`execution-plan.md`](execution-plan.md).

## Decisions that block Phase 0

These must be settled before the first build step.

| # | Decision | Proposal |
|---|---|---|
| 1 | Database access library | **jOOQ**: type-safe SQL that stays close to the queries in this design. The alternative is Exposed, a Kotlin DSL by JetBrains. |
| 2 | Where the server remembers `request_id`s | A nullable `request_id uuid` column on `node` and `cycle`, with `UNIQUE (user_id, request_id)`. A repeat of the same request finds the existing row. This changes `V1__init.sql`. |
| 3 | Postgres version | **Postgres 17** everywhere: local Docker and Neon. The schema needs Postgres 15 or later, because Postgres 14 lacks `NULLS NOT DISTINCT`. |

## Environments

| Environment | Database | Backend | Purpose |
|---|---|---|---|
| Local | Postgres in Docker (`docker compose up`) | Run from Gradle | Development and tests |
| Tests | Postgres in Testcontainers, one per test run | In the test process | CI and local tests |
| Production | Neon | Cloud Run | Real users |

A staging environment is not in v1. A Neon branch (a copy-on-write copy of the database) can serve as staging later at no extra cost.

The local database creates the same roles as production, with an init script. Code that works locally then has the same permissions in production.

## Postgres roles

No human and no service uses a more powerful role than its job needs.

| Role | Used by | Can do | Cannot do |
|---|---|---|---|
| `neondb_owner` (Neon default) | The project owner, for initial setup only | Everything, including creating roles | — |
| `focusledger_migrate` | The CI deploy job, to run Flyway migrations | Owns the schema. DDL: `CREATE`, `ALTER`, `DROP`. | — |
| `focusledger_app` | The Cloud Run service at runtime | `SELECT`, `INSERT`, `UPDATE` on the tables. `USAGE` on the sequences. | `DELETE`, `TRUNCATE`, and any DDL |

- `focusledger_app` has **no `DELETE`**. The design never deletes a node, a cycle, an estimate row, or (in v1) an account. The database permission enforces that rule a second time, below the triggers.
- The migrate role runs `ALTER DEFAULT PRIVILEGES` so that every table created later automatically grants `focusledger_app` the same three permissions.
- Create both roles **with SQL**, not in the Neon console. Neon gives console-created roles membership in `neon_superuser`. A role created with SQL starts with only the basic privileges and gets exactly the grants we add ([Neon: Manage roles](https://neon.com/docs/manage/roles)).
- When account deletion arrives, it gets its own narrow permission, not a general `DELETE` grant.

### Humans and production data

- No human has standing access to production data. Humans never use the service credentials.
- To investigate a problem, the owner creates a temporary read-only login with an expiry (`CREATE ROLE ... LOGIN VALID UNTIL '<time>'`, granted `SELECT` only), and writes down why in the investigation notes. The login stops working at the expiry time.
- Schema changes reach production only through the CI migration job, never by hand.

### Connection strings

Neon gives two connection strings for each role ([Neon: Connection pooling](https://neon.com/docs/connect/connection-pooling)):

| String | Hostname | Used by | Why |
|---|---|---|---|
| Pooled | contains `-pooler` | `focusledger_app` (Cloud Run) | PgBouncer pooling handles many short connections from a service that scales up and down. |
| Direct | no `-pooler` | `focusledger_migrate` (Flyway) | The pooler runs in transaction mode, which lacks the session features that migration tools need. Neon says to run Flyway on the direct string ([Neon: Flyway](https://neon.com/docs/guides/flyway)). |

## Secrets and service accounts (Google Cloud)

### Secrets

Stored in Secret Manager. Never in the repository, in files, or in logs.

| Secret | Read by |
|---|---|
| `DB_URL_APP` (pooled, `focusledger_app`) | Cloud Run service |
| `DB_URL_MIGRATE` (direct, `focusledger_migrate`) | CI deploy job |
| `SESSION_SIGNING_KEY` | Cloud Run service |
| `GOOGLE_CLIENT_ID` | Cloud Run service |

The free tier covers 6 active secret versions and 10,000 access operations a month ([Secret Manager pricing](https://cloud.google.com/secret-manager/pricing)). Four secrets fit. Cloud Run reads the secrets once per instance start. A rotated secret creates a new version, so old versions must be destroyed to stay inside 6. The MCP token signing key, when it arrives, makes 5.

### Service accounts

| Service account | Used by | Permissions |
|---|---|---|
| `focusledger-run` | The Cloud Run service identity | Read `DB_URL_APP`, `SESSION_SIGNING_KEY`, `GOOGLE_CLIENT_ID`. Nothing else. |
| `focusledger-deploy` | GitHub Actions | Push images to Artifact Registry. Deploy the Cloud Run service. Act as `focusledger-run` (needed to deploy a service with that identity). Read `DB_URL_MIGRATE`. |

- GitHub Actions signs in to Google Cloud with **Workload Identity Federation**: GitHub proves which repository and branch is running, and Google issues a short-lived credential. No service-account key file exists anywhere.
- Only the `main` branch of this repository can act as `focusledger-deploy`.
- The owner's personal Google account creates the project, the service accounts, and the secrets once. After that, every deploy goes through CI.

## Backend service

### Module layout

**Not yet agreed.** This layout is a first proposal for discussion. No work builds on it until the owner approves it.

```
proto/                      the .proto contract
backend/
  core/                     ledger and account services, all rules, no framework imports
  data/                     jOOQ repositories, Flyway migrations
  api-grpc/                 Armeria gRPC handlers, session check
  api-mcp/                  Ktor MCP server and tools
  app/                      main(): wiring, config, starts Armeria and Ktor
web/                        React + TypeScript web app
site/                       pre-rendered public pages
docker-compose.yml          local Postgres
```

- `core` depends on nothing but Kotlin and the interfaces it declares for data access. `api-grpc` and `api-mcp` depend on `core`, never on each other.
- Wiring is plain constructor calls in `app`. There is no dependency-injection framework.

### Configuration

All configuration comes from environment variables. Locally, a `.env.example` file lists them, and a real `.env` stays out of git.

| Variable | Example (local) |
|---|---|
| `DB_URL_APP` | `jdbc:postgresql://localhost:5432/focusledger?user=focusledger_app` |
| `DB_URL_MIGRATE` | `jdbc:postgresql://localhost:5432/focusledger?user=focusledger_migrate` |
| `SESSION_SIGNING_KEY` | a random local-only value |
| `GOOGLE_CLIENT_ID` | the development OAuth client ID |
| `PORT` | `8080` (Cloud Run sets it) |

### Connection pool

HikariCP with a small pool: 4 connections, and a minimum idle of 0 so that an idle instance holds no connections. Neon's pooler does the heavy pooling. A large pool per instance would only multiply connections as Cloud Run adds instances.

### Migrations

- Flyway, files under `backend/data/src/main/resources/db/migration/`.
- `V1__init.sql` is the draft DDL from the schema design, plus the roles and grants, plus decision 2 above.
- The CI deploy job runs migrations with `DB_URL_MIGRATE` **before** it deploys the new service. Every migration must work with the service version that is already running. A column rename, for example, is split across two deploys.

## What the setup does not cover

- The MCP OAuth tables and keys. They are in [`mcp.md`](mcp.md).
- Monitoring, error tracking, and backups. They come before launch, in the execution plan.
