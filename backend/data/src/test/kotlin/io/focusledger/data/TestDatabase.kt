package io.focusledger.data

import java.nio.file.Path
import java.sql.Connection
import java.sql.DriverManager
import java.sql.SQLException
import org.flywaydb.core.api.output.MigrateResult
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.assertThrows
import org.testcontainers.containers.output.OutputFrame
import org.testcontainers.postgresql.PostgreSQLContainer
import org.testcontainers.utility.MountableFile

/**
 * One Postgres 18 per test JVM, set up like the local Docker database (the role script as a
 * non-superuser owner), then migrated with V1 as focusledger_migrate. Tests that change data use
 * their own users, so they do not depend on each other.
 */
object TestDatabase {
    const val SUPERUSER = "postgres"
    const val OWNER = "focusledger_owner"
    const val MIGRATE = "focusledger_migrate"
    const val APP = "focusledger_app"

    const val INSUFFICIENT_PRIVILEGE = "42501"
    const val UNIQUE_VIOLATION = "23505"
    const val FOREIGN_KEY_VIOLATION = "23503"
    const val NOT_NULL_VIOLATION = "23502"
    const val CHECK_VIOLATION = "23514"

    private const val DOCKER_POSTGRES_DIR_PROPERTY = "focusledger.dockerPostgresDir"

    val dockerPostgresDir: Path =
        Path.of(
            System.getProperty(DOCKER_POSTGRES_DIR_PROPERTY)
                ?: error(
                    "Set the system property $DOCKER_POSTGRES_DIR_PROPERTY to the docker/postgres folder. " +
                        "The backend/data Gradle test task sets it."
                )
        )

    private val postgres =
        PostgreSQLContainer("postgres:18")
            .withDatabaseName("focusledger")
            .withUsername(SUPERUSER)
            .withEnv("POSTGRES_HOST_AUTH_METHOD", "trust")
            .withCopyFileToContainer(
                MountableFile.forHostPath(dockerPostgresDir.resolve("init")),
                "/docker-entrypoint-initdb.d",
            )
            .withCopyFileToContainer(
                MountableFile.forHostPath(dockerPostgresDir.resolve("roles.sql")),
                "/focusledger/roles.sql",
            )
            .withLogConsumer { frame: OutputFrame ->
                System.err.print("[postgres] ${frame.utf8String}")
            }

    /** The result of the first migration, which ran when this object started. */
    val firstMigration: MigrateResult

    init {
        postgres.start()
        firstMigration = migrate()
    }

    fun migrate(): MigrateResult = LedgerMigrations.flyway(jdbcUrl(MIGRATE)).migrate()

    fun connectAs(role: String): Connection = DriverManager.getConnection(jdbcUrl(role))

    private fun jdbcUrl(role: String) =
        "jdbc:postgresql://${postgres.host}:${postgres.firstMappedPort}/focusledger?user=$role"
}

fun Connection.execute(sql: String, vararg parameters: Any?) {
    prepareStatement(sql).use { statement ->
        parameters.forEachIndexed { index, value -> statement.setObject(index + 1, value) }
        statement.execute()
    }
}

/** Runs [sql] and returns the first column of every row. */
fun Connection.queryColumn(sql: String, vararg parameters: Any?): List<String?> =
    prepareStatement(sql).use { statement ->
        parameters.forEachIndexed { index, value -> statement.setObject(index + 1, value) }
        statement.executeQuery().use { rows ->
            buildList { while (rows.next()) add(rows.getString(1)) }
        }
    }

fun Connection.queryRows(sql: String, vararg parameters: Any?): Set<String> =
    queryColumn(sql, *parameters).filterNotNull().toSet()

fun Connection.queryString(sql: String, vararg parameters: Any?): String? =
    queryColumn(sql, *parameters).single()

fun Connection.assertFails(expectedSqlState: String, sql: String, vararg parameters: Any?) {
    val error = assertThrows<SQLException> { execute(sql, *parameters) }
    assertEquals(expectedSqlState, error.sqlState, error.message)
}

fun Connection.assertDenied(sql: String, vararg parameters: Any?) =
    assertFails(TestDatabase.INSUFFICIENT_PRIVILEGE, sql, *parameters)
