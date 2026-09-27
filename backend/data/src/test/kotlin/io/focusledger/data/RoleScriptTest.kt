package io.focusledger.data

import java.nio.file.Path
import java.sql.Connection
import java.sql.DriverManager
import java.sql.SQLException
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertDoesNotThrow
import org.junit.jupiter.api.assertThrows
import org.testcontainers.postgresql.PostgreSQLContainer
import org.testcontainers.utility.MountableFile

/**
 * Runs the local Docker init (the role script as a non-superuser owner) on Postgres 18, then checks
 * the rights of focusledger_app. Item 2 replaces [createProbeTableInPlaceOfV1] with the real V1.
 */
class RoleScriptTest {

    @Test
    fun owner_isNotSuperuser() {
        val isSuperuser =
            connectAs("postgres").use {
                it.queryBoolean("SELECT rolsuper FROM pg_roles WHERE rolname = 'focusledger_owner'")
            }

        assertFalse(isSuperuser)
    }

    @Test
    fun ledgerSchema_isOwnedByMigrate() {
        val schemaOwner =
            connectAs("postgres").use {
                it.queryString(
                    "SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = 'ledger'"
                )
            }

        assertEquals("focusledger_migrate", schemaOwner)
    }

    @Test
    fun accountSchema_isOwnedByMigrate() {
        val schemaOwner =
            connectAs("postgres").use {
                it.queryString(
                    "SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = 'account'"
                )
            }

        assertEquals("focusledger_migrate", schemaOwner)
    }

    @Test
    fun citextExtension_isInstalled() {
        val extensionCount =
            connectAs("postgres").use {
                it.queryString("SELECT count(*) FROM pg_extension WHERE extname = 'citext'")
            }

        assertEquals("1", extensionCount)
    }

    @Test
    fun app_insertIntoLedgerTable_succeeds() {
        connectAs(APP).use {
            assertDoesNotThrow { it.execute("INSERT INTO ledger.probe (id) VALUES (1)") }
        }
    }

    @Test
    fun app_selectFromLedgerTable_succeeds() {
        connectAs(APP).use { assertDoesNotThrow { it.execute("SELECT id FROM ledger.probe") } }
    }

    @Test
    fun app_updateLedgerTable_succeeds() {
        connectAs(APP).use { assertDoesNotThrow { it.execute("UPDATE ledger.probe SET id = id") } }
    }

    @Test
    fun app_deleteFromLedgerTable_isDenied() {
        connectAs(APP).use { it.assertDenied("DELETE FROM ledger.probe") }
    }

    @Test
    fun app_truncateLedgerTable_isDenied() {
        connectAs(APP).use { it.assertDenied("TRUNCATE ledger.probe") }
    }

    @Test
    fun app_createTempTable_isDenied() {
        connectAs(APP).use { it.assertDenied("CREATE TEMP TABLE scratch (id int)") }
    }

    @Test
    fun app_createTableInLedger_isDenied() {
        connectAs(APP).use { it.assertDenied("CREATE TABLE ledger.intruder (id int)") }
    }

    @Test
    fun app_createTableInAccount_isDenied() {
        connectAs(APP).use { it.assertDenied("CREATE TABLE account.intruder (id int)") }
    }

    @Test
    fun app_createTableInPublic_isDenied() {
        connectAs(APP).use { it.assertDenied("CREATE TABLE public.intruder (id int)") }
    }

    @Test
    fun app_createSchema_isDenied() {
        connectAs(APP).use { it.assertDenied("CREATE SCHEMA intruder") }
    }

    @Test
    fun roleWithoutGrants_connect_isDenied() {
        val error = assertThrows<SQLException> { connectAs(UNGRANTED_ROLE) }

        assertEquals(INSUFFICIENT_PRIVILEGE, error.sqlState)
    }

    companion object {
        private const val APP = "focusledger_app"
        private const val MIGRATE = "focusledger_migrate"
        private const val UNGRANTED_ROLE = "ungranted_login"
        private const val INSUFFICIENT_PRIVILEGE = "42501"

        private val dockerPostgresDir = Path.of(System.getProperty("focusledger.dockerPostgresDir"))

        private val postgres =
            PostgreSQLContainer("postgres:18")
                .withDatabaseName("focusledger")
                .withUsername("postgres")
                .withEnv("POSTGRES_HOST_AUTH_METHOD", "trust")
                .withCopyFileToContainer(
                    MountableFile.forHostPath(dockerPostgresDir.resolve("init"), 0b111_101_101),
                    "/docker-entrypoint-initdb.d",
                )
                .withCopyFileToContainer(
                    MountableFile.forHostPath(dockerPostgresDir.resolve("roles.sql")),
                    "/focusledger/roles.sql",
                )

        @JvmStatic
        @BeforeAll
        fun startDatabase() {
            postgres.start()
            createProbeTableInPlaceOfV1()
            connectAs("focusledger_owner").use { it.execute("CREATE ROLE $UNGRANTED_ROLE LOGIN") }
        }

        @JvmStatic
        @AfterAll
        fun stopDatabase() {
            postgres.stop()
        }

        /** The default-privilege statements that docs/setup.md gives for V1, then one table. */
        private fun createProbeTableInPlaceOfV1() {
            connectAs(MIGRATE).use { migrate ->
                listOf(
                        "GRANT USAGE ON SCHEMA ledger  TO ledger_reader",
                        "GRANT USAGE ON SCHEMA account TO account_reader",
                        "ALTER DEFAULT PRIVILEGES IN SCHEMA ledger  GRANT SELECT ON TABLES TO ledger_reader",
                        "ALTER DEFAULT PRIVILEGES IN SCHEMA ledger  GRANT INSERT, UPDATE ON TABLES TO ledger_writer",
                        "ALTER DEFAULT PRIVILEGES IN SCHEMA ledger  GRANT USAGE ON SEQUENCES TO ledger_writer",
                        "ALTER DEFAULT PRIVILEGES IN SCHEMA account GRANT SELECT ON TABLES TO account_reader",
                        "ALTER DEFAULT PRIVILEGES IN SCHEMA account GRANT INSERT, UPDATE ON TABLES TO account_writer",
                        "ALTER DEFAULT PRIVILEGES IN SCHEMA account GRANT USAGE ON SEQUENCES TO account_writer",
                        "CREATE TABLE ledger.probe (id int)",
                    )
                    .forEach { statement -> migrate.execute(statement) }
            }
        }

        private fun connectAs(role: String): Connection =
            DriverManager.getConnection(
                "jdbc:postgresql://${postgres.host}:${postgres.firstMappedPort}/focusledger?user=$role"
            )

        private fun Connection.execute(sql: String) {
            createStatement().use { it.execute(sql) }
        }

        private fun Connection.queryString(sql: String): String =
            createStatement().use { statement ->
                statement.executeQuery(sql).use { rows ->
                    rows.next()
                    rows.getString(1)
                }
            }

        private fun Connection.queryBoolean(sql: String): Boolean =
            createStatement().use { statement ->
                statement.executeQuery(sql).use { rows ->
                    rows.next()
                    rows.getBoolean(1)
                }
            }

        private fun Connection.assertDenied(sql: String) {
            val error = assertThrows<SQLException> { execute(sql) }
            assertEquals(INSUFFICIENT_PRIVILEGE, error.sqlState, error.message)
        }
    }
}
