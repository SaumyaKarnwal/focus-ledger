package io.focusledger.data.codegen

import java.nio.file.Path
import org.flywaydb.core.Flyway
import org.jooq.codegen.GenerationTool
import org.jooq.meta.jaxb.Configuration
import org.jooq.meta.jaxb.Database
import org.jooq.meta.jaxb.ForcedType
import org.jooq.meta.jaxb.Generate
import org.jooq.meta.jaxb.Generator
import org.jooq.meta.jaxb.Jdbc
import org.jooq.meta.jaxb.SchemaMappingType
import org.jooq.meta.jaxb.Target
import org.testcontainers.postgresql.PostgreSQLContainer
import org.testcontainers.utility.MountableFile

/**
 * Generates the jOOQ classes from V1 as Flyway applies it to Postgres 18, set up like the local
 * Docker database. Arguments: the docker/postgres folder, the migration folder, the output folder.
 */
fun main(args: Array<String>) {
    val (dockerPostgresDir, migrationDir, outputDir) = args.map { Path.of(it) }
    PostgreSQLContainer("postgres:18")
        .withDatabaseName("focusledger")
        .withUsername("postgres")
        .withEnv("POSTGRES_HOST_AUTH_METHOD", "trust")
        .withCopyFileToContainer(
            MountableFile.forHostPath(dockerPostgresDir.resolve("init")),
            "/docker-entrypoint-initdb.d",
        )
        .withCopyFileToContainer(
            MountableFile.forHostPath(dockerPostgresDir.resolve("roles.sql")),
            "/focusledger/roles.sql",
        )
        .use { postgres ->
            postgres.start()
            val migrateUrl =
                "jdbc:postgresql://${postgres.host}:${postgres.firstMappedPort}/focusledger?user=focusledger_migrate"
            // The same settings as LedgerMigrations, which main code holds and this code cannot
            // use.
            Flyway.configure()
                .dataSource(migrateUrl, null, null)
                .schemas("ledger", "account")
                .defaultSchema("ledger")
                .createSchemas(false)
                .placeholderReplacement(false)
                .locations("filesystem:$migrationDir")
                .load()
                .migrate()
            GenerationTool.generate(configuration(migrateUrl, outputDir))
        }
}

private fun configuration(jdbcUrl: String, outputDir: Path) =
    Configuration()
        .withJdbc(Jdbc().withDriver("org.postgresql.Driver").withUrl(jdbcUrl))
        .withGenerator(
            Generator()
                .withDatabase(
                    Database()
                        .withName("org.jooq.meta.postgres.PostgresDatabase")
                        .withSchemata(
                            SchemaMappingType().withInputSchema("ledger"),
                            SchemaMappingType().withInputSchema("account"),
                        )
                        .withExcludes("flyway_schema_history")
                        .withForcedTypes(
                            ForcedType().withName("VARCHAR").withIncludeTypes("citext"),
                            ForcedType()
                                .withName("INSTANT")
                                .withIncludeTypes("timestamptz|timestamp with time zone"),
                        )
                )
                .withGenerate(Generate().withRoutines(false).withJavaTimeTypes(true))
                .withTarget(
                    Target()
                        .withPackageName("io.focusledger.data.jooq")
                        .withDirectory(outputDir.toString())
                )
        )
