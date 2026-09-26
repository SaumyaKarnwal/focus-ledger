# Focus Ledger

Focus Ledger is a personal time ledger. Each work cycle records its node (what you worked on) and its mode (Deep Focus, Execution, or Shallow). The report is a node × mode cross-tab.

The design is in [`docs/`](docs/). Start with [`docs/prd.md`](docs/prd.md) and [`docs/architecture.md`](docs/architecture.md).

## Requirements

- JDK 21
- Node.js 24 with Corepack (Corepack supplies pnpm)
- Docker

## Run the checks

1. Start the local database: `docker compose up -d --wait`
2. Build and check the backend: `./gradlew build spotlessCheck`
3. Check the web app: `cd web && corepack pnpm install && corepack pnpm test && corepack pnpm lint`

## License

Apache-2.0. See [`LICENSE`](LICENSE).
