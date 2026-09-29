# Build the program first with `./gradlew :backend:app:installDist`. The jOOQ code generation
# starts Postgres in Testcontainers, so the build needs a Docker host and cannot run in this image.
FROM eclipse-temurin:21-jre
RUN useradd --system --uid 10001 focusledger
COPY backend/app/build/install/app /app
USER focusledger
ENTRYPOINT ["/app/bin/app"]
