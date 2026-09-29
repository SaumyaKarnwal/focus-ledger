FROM node:24 AS web
WORKDIR /src
COPY buf.yaml ./
COPY proto proto
COPY testdata testdata
COPY web web
WORKDIR /src/web
RUN corepack pnpm install --frozen-lockfile && corepack pnpm build

# Build the backend first with `./gradlew :backend:app:installDist`. The jOOQ code generation
# starts Postgres in Testcontainers, so that build needs a Docker host and cannot run in this image.
FROM eclipse-temurin:21-jre
RUN useradd --system --uid 10001 focusledger
COPY backend/app/build/install/app /app
COPY --from=web /src/web/dist /app/web
USER focusledger
ENTRYPOINT ["/app/bin/app"]
