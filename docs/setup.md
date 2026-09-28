# Focus Ledger — Database and Backend Setup (v1)

Status: draft for review. Everything in this doc is **proposed** until approved. The architecture is in [`architecture.md`](architecture.md). The execution plan is in [`execution-plan.md`](execution-plan.md).

## Decisions that block Phase 0

These must be settled before the first build step.

| # | Decision | Proposal |
|---|---|---|
| 1 | Database access library | **Agreed: jOOQ.** Type-safe SQL, generated from the migrated schema. It builds the dynamic `SET` clause that the update mask needs. The runner-up was SQLDelight. |
| 2 | Where the server remembers `request_id`s | **Agreed:** a required `request_id uuid NOT NULL` column on `ledger.node` and `ledger.cycle`, with `UNIQUE (user_id, request_id)`. A repeat finds the existing row. See `schema.md`, "Idempotency". |
| 3 | Postgres version | **Agreed: Postgres 18** everywhere: local Docker, Testcontainers, and Neon. It is supported until November 2030, and it has a built-in `uuidv7()`. The schema itself works on any supported version. The Phase 0 spike confirms that jOOQ, Flyway, and the Testcontainers image support 18. If one does not, the fallback is Postgres 17, with no design change. |

## Toolchain (agreed)

| Choice | Decision |
|---|---|
| Java | JDK 21 (long-term support) |
| Build | Gradle with Kotlin scripts and a version catalog (`gradle/libs.versions.toml`) |
| Proto code generation | `buf generate` for both sides: Kotlin (protobuf + grpc-kotlin) and TypeScript (`protoc-gen-es` + Connect's gRPC-Web transport) |
| Web | React + Vite + TypeScript, pnpm, Vitest |
| Backend tests | JUnit 5 + Testcontainers (Postgres 18) |
| Format and lint | Spotless with ktfmt (Kotlin), ESLint + Prettier (web) |
| License | Apache-2.0 |

## Environments

| Environment | Database | Backend | Purpose |
|---|---|---|---|
| Local | Postgres in Docker (`docker compose up`) | Run from Gradle | Development and tests |
| Tests | Postgres in Testcontainers, one per test run | In the test process | CI and local tests |
| Production | Neon | Cloud Run | Real users |

A staging environment is not in v1. A Neon branch (a copy-on-write copy of the database) can serve as staging later at no extra cost.

The local database creates the same roles as production, with an init script. Code that works locally then has the same permissions in production.

## Schemas and Postgres roles

No human and no service uses a more powerful role than its job needs.

### Two schemas

| Schema | Tables | Holds |
|---|---|---|
| `account` | `app_user`, `user_settings` | Personal data: email, preferences |
| `ledger` | `node`, `cycle`, `estimate` | Work data. No names or emails. |

- A schema is a namespace. It adds no cost at run time: one database, one connection pool, and cross-schema foreign keys (`ledger.node.user_id → account.app_user.id`) work as usual.
- The split lets a reader get the work data without the personal data. Example: a debug login or a future read-only service gets `ledger_reader` only and cannot read any email.
- A future service that only reads gets a rights role, not a new schema. A service that writes its own tables gets its own schema, so that its write rights stay inside that schema.
- Moving a table to another schema later is one statement (`ALTER TABLE ... SET SCHEMA`), plus regenerated jOOQ classes and updated grants.

### Rights roles and login roles

Rights are granted to **rights roles** that cannot log in. **Login roles** receive rights roles. A new table gets its rights automatically from default privileges on its schema, so no migration adds grants table by table.

| Role | Kind | Rights |
|---|---|---|
| `ledger_reader` | rights, no login | `USAGE` on `ledger`. `SELECT` on its tables. |
| `ledger_writer` | rights, no login | `ledger_reader`, plus `INSERT`, `UPDATE` on `ledger` tables and `USAGE` on its sequences |
| `account_reader` | rights, no login | `USAGE` on `account`. `SELECT` on its tables. |
| `account_writer` | rights, no login | `account_reader`, plus `INSERT`, `UPDATE` on `account` tables and `USAGE` on its sequences |
| `neondb_owner` (Neon default) | login | Everything. The project owner uses it for the initial setup only. |
| `focusledger_migrate` | login | Owns both schemas, so it can create and change tables. Used only by the CI deploy job. |
| `focusledger_app` | login | `ledger_writer` + `account_writer`. Used by the Cloud Run service. |

- No rights role has `DELETE`, `TRUNCATE`, or DDL. The design never deletes a node, a cycle, an estimate row, or (in v1) an account, and the database enforces that rule a second time, below the triggers.
- Create every role **with SQL**, not in the Neon console. Neon gives console-created roles membership in `neon_superuser`. A role created with SQL starts with only the basic privileges and gets exactly the grants we add ([Neon: Manage roles](https://neon.com/docs/manage/roles)).
- When account deletion arrives, it gets its own narrow permission, not a general `DELETE` grant.

### How the roles are created

The owner runs this once, as `neondb_owner`. The generated passwords go straight into Secret Manager and nowhere else.

```sql
-- Only granted roles may connect or create temporary tables.
REVOKE CONNECT, TEMPORARY ON DATABASE neondb FROM PUBLIC;

-- The owner installs the extension. The migrate role has no database-level CREATE.
CREATE EXTENSION IF NOT EXISTS citext;

CREATE ROLE focusledger_migrate LOGIN PASSWORD '<generated>';
CREATE ROLE focusledger_app     LOGIN PASSWORD '<generated>';

CREATE ROLE ledger_reader  NOLOGIN;
CREATE ROLE ledger_writer  NOLOGIN;
CREATE ROLE account_reader NOLOGIN;
CREATE ROLE account_writer NOLOGIN;
GRANT ledger_reader  TO ledger_writer;
GRANT account_reader TO account_writer;

-- Postgres 16+: to create a schema owned by another role, the owner must be able to SET ROLE to it.
GRANT focusledger_migrate TO neondb_owner WITH INHERIT FALSE, SET TRUE;
CREATE SCHEMA ledger  AUTHORIZATION focusledger_migrate;
CREATE SCHEMA account AUTHORIZATION focusledger_migrate;

GRANT CONNECT ON DATABASE neondb TO focusledger_migrate, ledger_reader, account_reader;
GRANT ledger_writer, account_writer TO focusledger_app;
```

- `REVOKE ... FROM PUBLIC` closes two defaults: any role could connect, and any role could create temporary tables. After it, only the roles above can connect.
- `citext` is created by the owner once. `V1__init.sql` uses it and does not create it.
- The grant to `neondb_owner` has `INHERIT FALSE`: the owner does not pick up the migrate role's rights automatically. It can only switch to that role on purpose.
- The Phase 0 scaffold tests this script on Postgres 18 as a non-superuser owner (with `CREATEROLE`, like `neondb_owner` on Neon), then runs `V1__init.sql` as `focusledger_migrate`, then checks that `focusledger_app` cannot `DELETE`, cannot create a temporary table, and cannot create a table.

The first migration, `V1__init.sql`, runs as `focusledger_migrate` and sets the default privileges before it creates any table:

```sql
GRANT USAGE ON SCHEMA ledger  TO ledger_reader;
GRANT USAGE ON SCHEMA account TO account_reader;

ALTER DEFAULT PRIVILEGES IN SCHEMA ledger  GRANT SELECT ON TABLES TO ledger_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA ledger  GRANT INSERT, UPDATE ON TABLES TO ledger_writer;
ALTER DEFAULT PRIVILEGES IN SCHEMA ledger  GRANT USAGE ON SEQUENCES TO ledger_writer;
ALTER DEFAULT PRIVILEGES IN SCHEMA account GRANT SELECT ON TABLES TO account_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA account GRANT INSERT, UPDATE ON TABLES TO account_writer;
ALTER DEFAULT PRIVILEGES IN SCHEMA account GRANT USAGE ON SEQUENCES TO account_writer;
```

The local Postgres in `docker compose` runs the same role script at first start, so local code meets the same permissions as production.

### Humans and production data

- No human has standing access to production data. Humans never use the service credentials.
- To investigate a problem, the owner creates a temporary login with an expiry and grants it `ledger_reader` only (`CREATE ROLE debug_<date> LOGIN PASSWORD '<generated>' VALID UNTIL '<time>'; GRANT ledger_reader TO debug_<date>;`). It sees the work data and no personal data. The owner writes down why in the investigation notes. The login stops working at the expiry time. Grant `account_reader` too only when the problem is in the account data.
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

### Module layout (agreed)

```
proto/                      the .proto contract
backend/
  core/                     ledger and account services, all rules, no framework imports
  data/                     jOOQ repositories, Flyway migrations
  api-grpc/                 Armeria gRPC handlers, session check
  api-mcp/                  Ktor MCP server and tools
  app/                      main(): wiring, config, starts Armeria and Ktor
web/                        React + TypeScript web app
site/                       pre-rendered public pages (added later, not in Phase 0)
infra/                      deploy setup (added by ws-c; its tool is decided then)
docs/                       design docs
docker-compose.yml          local Postgres 18 with the role script
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

## Backups

There is no backup job in v1. The owner accepts Neon's free-plan history retention of 6 hours: the database can be restored, or branched, to any moment in the last 6 hours. The design also limits data loss: the app role cannot delete, and cycles are append-only.

Before any risky change (a large migration, a bulk data fix), create a Neon branch first. A branch is an instant, free copy of the database at that moment, and it stays until someone deletes it.

## Provisioning

The step-by-step sign-ups and provisioning (Google Cloud, the sign-in client, Neon, secrets, service accounts, the domain, GitHub settings) are in [`runbooks/provisioning.md`](runbooks/provisioning.md).

## What the setup does not cover

- The MCP OAuth tables and keys. They are in [`mcp.md`](mcp.md).
- Monitoring, error tracking, and backups. They come before launch, in the execution plan.
