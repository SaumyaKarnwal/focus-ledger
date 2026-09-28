# Ekagra

Ekagra is a personal time ledger. Its internal name, in the code and the repository, is `focus-ledger`. Each work cycle records its node (what you worked on) and its mode (Deep Focus, Execution, or Shallow). The report is a node × mode cross-tab.

The design is in [`docs/`](docs/). Start with [`docs/prd.md`](docs/prd.md) and [`docs/architecture.md`](docs/architecture.md).

## Requirements

- JDK 21
- Node.js 24.15 or a later 24.x (see `web/.nvmrc`). Node 24 includes Corepack, and Corepack supplies pnpm.
- Docker

## Run the checks

Run these commands from the repository root:

1. Copy the local settings: `cp -n .env.example .env`
2. Start the local database: `docker compose up -d --wait`
3. Build and check the backend: `./gradlew build`
4. Check the web app: `(cd web && corepack pnpm install && corepack pnpm test && corepack pnpm lint && corepack pnpm build)`

The database runs its init scripts only on an empty volume. After a change to `docker/postgres/`, reset the database with `docker compose down -v && docker compose up -d --wait`.

## License

Apache-2.0. See [`LICENSE`](LICENSE).
