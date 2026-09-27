package io.focusledger.data

import java.nio.file.Files
import java.nio.file.Path
import java.sql.Connection
import java.sql.DriverManager
import java.sql.SQLException
import kotlin.io.path.extension
import kotlin.io.path.listDirectoryEntries
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertDoesNotThrow
import org.junit.jupiter.api.assertThrows
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import org.testcontainers.containers.output.OutputFrame
import org.testcontainers.postgresql.PostgreSQLContainer
import org.testcontainers.utility.MountableFile

/**
 * Runs the local Docker init (the role script as a non-superuser owner) on Postgres 18, then checks
 * the roles and their rights. Until `V1__init.sql` exists, one probe table per schema stands in for
 * it.
 */
class RoleScriptTest {

    @Test
    fun roles_haveExpectedAttributes() {
        val attributes =
            connectAs(SUPERUSER).use {
                it.queryRows(
                    """
                    SELECT rolname || ': login=' || rolcanlogin || ' super=' || rolsuper
                        || ' createrole=' || rolcreaterole || ' createdb=' || rolcreatedb
                        || ' replication=' || rolreplication || ' bypassrls=' || rolbypassrls
                    FROM pg_roles
                    WHERE rolname IN ($OWNED_ROLES_SQL_LIST)
                    """
                )
            }

        assertEquals(
            setOf(
                "focusledger_owner: login=true super=false createrole=true createdb=true replication=false bypassrls=false",
                "focusledger_migrate: login=true super=false createrole=false createdb=false replication=false bypassrls=false",
                "focusledger_app: login=true super=false createrole=false createdb=false replication=false bypassrls=false",
                "ledger_reader: login=false super=false createrole=false createdb=false replication=false bypassrls=false",
                "ledger_writer: login=false super=false createrole=false createdb=false replication=false bypassrls=false",
                "account_reader: login=false super=false createrole=false createdb=false replication=false bypassrls=false",
                "account_writer: login=false super=false createrole=false createdb=false replication=false bypassrls=false",
            ),
            attributes,
        )
    }

    @Test
    fun ownerGrants_haveExpectedMembersAndOptions() {
        val memberships =
            connectAs(SUPERUSER).use {
                it.queryRows(
                    """
                    SELECT granted.rolname || ' to ' || member.rolname || ': admin=' || m.admin_option
                        || ' inherit=' || m.inherit_option || ' set=' || m.set_option
                    FROM pg_auth_members m
                    JOIN pg_roles granted ON granted.oid = m.roleid
                    JOIN pg_roles member ON member.oid = m.member
                    WHERE m.grantor = 'focusledger_owner'::regrole
                        AND member.rolname IN ($OWNED_ROLES_SQL_LIST)
                    """
                )
            }

        assertEquals(
            setOf(
                "focusledger_migrate to focusledger_owner: admin=false inherit=false set=true",
                "ledger_reader to ledger_writer: admin=false inherit=true set=true",
                "account_reader to account_writer: admin=false inherit=true set=true",
                "ledger_writer to focusledger_app: admin=false inherit=true set=true",
                "account_writer to focusledger_app: admin=false inherit=true set=true",
            ),
            memberships,
        )
    }

    @Test
    fun database_grantsOnlyExpectedRights() {
        val databaseRights =
            connectAs(SUPERUSER).use {
                it.queryRows(
                    """
                    SELECT CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END
                        || ': ' || acl.privilege_type
                    FROM pg_database d, aclexplode(d.datacl) acl
                    WHERE d.datname = current_database()
                    """
                )
            }

        assertEquals(
            setOf(
                "focusledger_owner: CONNECT",
                "focusledger_owner: CREATE",
                "focusledger_owner: TEMPORARY",
                "focusledger_migrate: CONNECT",
                "ledger_reader: CONNECT",
                "account_reader: CONNECT",
            ),
            databaseRights,
        )
    }

    @Test
    fun citextExtension_isOwnedByNonSuperuserOwner() {
        val extensionOwner =
            connectAs(SUPERUSER).use {
                it.queryString(
                    "SELECT pg_get_userbyid(extowner) FROM pg_extension WHERE extname = 'citext'"
                )
            }

        assertEquals(OWNER, extensionOwner)
    }

    @ParameterizedTest
    @ValueSource(strings = ["ledger", "account"])
    fun schema_isOwnedByMigrate(schema: String) {
        val schemaOwner =
            connectAs(SUPERUSER).use {
                it.queryString(
                    "SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = '$schema'"
                )
            }

        assertEquals(MIGRATE, schemaOwner)
    }

    @Test
    fun initShellScripts_areExecutable() {
        val shellScripts =
            dockerPostgresDir.resolve("init").listDirectoryEntries().filter { it.extension == "sh" }

        assertTrue(shellScripts.isNotEmpty())
        shellScripts.forEach { script ->
            assertTrue(Files.isExecutable(script), "$script is not executable")
        }
    }

    @ParameterizedTest
    @ValueSource(strings = ["ledger", "account"])
    fun app_selectFromProbe_succeeds(schema: String) {
        connectAs(APP).use { assertDoesNotThrow { it.execute("SELECT id FROM $schema.probe") } }
    }

    @ParameterizedTest
    @ValueSource(strings = ["ledger", "account"])
    fun app_insertIntoProbe_succeeds(schema: String) {
        connectAs(APP).use {
            assertDoesNotThrow { it.execute("INSERT INTO $schema.probe (id) VALUES (1)") }
        }
    }

    @ParameterizedTest
    @ValueSource(strings = ["ledger", "account"])
    fun app_updateProbe_succeeds(schema: String) {
        connectAs(APP).use { assertDoesNotThrow { it.execute("UPDATE $schema.probe SET id = id") } }
    }

    @ParameterizedTest
    @ValueSource(strings = ["ledger", "account"])
    fun app_deleteFromProbe_isDenied(schema: String) {
        connectAs(APP).use { it.assertDenied("DELETE FROM $schema.probe") }
    }

    @ParameterizedTest
    @ValueSource(strings = ["ledger", "account"])
    fun app_truncateProbe_isDenied(schema: String) {
        connectAs(APP).use { it.assertDenied("TRUNCATE $schema.probe") }
    }

    @ParameterizedTest
    @ValueSource(strings = ["ledger", "account", "public"])
    fun app_createTable_isDenied(schema: String) {
        connectAs(APP).use { it.assertDenied("CREATE TABLE $schema.intruder (id int)") }
    }

    @Test
    fun app_createTempTable_isDenied() {
        connectAs(APP).use { it.assertDenied("CREATE TEMP TABLE scratch (id int)") }
    }

    @Test
    fun app_createSchema_isDenied() {
        connectAs(APP).use { it.assertDenied("CREATE SCHEMA intruder") }
    }

    @Test
    fun ledgerReaderLogin_selectFromLedgerProbe_succeeds() {
        connectAs(LEDGER_READER_LOGIN).use {
            assertDoesNotThrow { it.execute("SELECT id FROM ledger.probe") }
        }
    }

    @Test
    fun ledgerReaderLogin_insertIntoLedgerProbe_isDenied() {
        connectAs(LEDGER_READER_LOGIN).use {
            it.assertDenied("INSERT INTO ledger.probe (id) VALUES (1)")
        }
    }

    @Test
    fun ledgerReaderLogin_selectFromAccountProbe_isDenied() {
        connectAs(LEDGER_READER_LOGIN).use { it.assertDenied("SELECT id FROM account.probe") }
    }

    @Test
    fun roleWithoutGrants_connect_isDenied() {
        val error = assertThrows<SQLException> { connectAs(UNGRANTED_LOGIN) }

        assertEquals(INSUFFICIENT_PRIVILEGE, error.sqlState)
    }

    companion object {
        private const val SUPERUSER = "postgres"
        private const val OWNER = "focusledger_owner"
        private const val MIGRATE = "focusledger_migrate"
        private const val APP = "focusledger_app"
        private const val LEDGER_READER_LOGIN = "ledger_reader_login"
        private const val UNGRANTED_LOGIN = "ungranted_login"
        private const val INSUFFICIENT_PRIVILEGE = "42501"
        private const val DOCKER_POSTGRES_DIR_PROPERTY = "focusledger.dockerPostgresDir"

        private val OWNED_ROLES_SQL_LIST =
            listOf(
                    OWNER,
                    MIGRATE,
                    APP,
                    "ledger_reader",
                    "ledger_writer",
                    "account_reader",
                    "account_writer",
                )
                .joinToString { "'$it'" }

        private val dockerPostgresDir: Path =
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

        @JvmStatic
        @BeforeAll
        fun startDatabase() {
            postgres.start()
            createProbeTablesInPlaceOfV1()
            connectAs(OWNER).use { owner ->
                owner.execute("CREATE ROLE $UNGRANTED_LOGIN LOGIN")
                owner.execute("CREATE ROLE $LEDGER_READER_LOGIN LOGIN IN ROLE ledger_reader")
            }
        }

        @JvmStatic
        @AfterAll
        fun stopDatabase() {
            postgres.stop()
        }

        /**
         * The default-privilege statements that docs/setup.md gives for V1, then one table per
         * schema.
         */
        private fun createProbeTablesInPlaceOfV1() {
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
                        "CREATE TABLE account.probe (id int)",
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

        private fun Connection.queryRows(sql: String): Set<String> =
            createStatement().use { statement ->
                statement.executeQuery(sql).use { rows ->
                    generateSequence { if (rows.next()) rows.getString(1) else null }.toSet()
                }
            }

        private fun Connection.queryString(sql: String): String = queryRows(sql).single()

        private fun Connection.assertDenied(sql: String) {
            val error = assertThrows<SQLException> { execute(sql) }
            assertEquals(INSUFFICIENT_PRIVILEGE, error.sqlState, error.message)
        }
    }
}
