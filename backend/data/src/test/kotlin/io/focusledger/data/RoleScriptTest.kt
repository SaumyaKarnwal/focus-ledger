package io.focusledger.data

import io.focusledger.data.TestDatabase.APP
import io.focusledger.data.TestDatabase.MIGRATE
import io.focusledger.data.TestDatabase.OWNER
import io.focusledger.data.TestDatabase.SUPERUSER
import io.focusledger.data.TestDatabase.connectAs
import java.nio.file.Files
import java.sql.SQLException
import kotlin.io.path.extension
import kotlin.io.path.listDirectoryEntries
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertDoesNotThrow
import org.junit.jupiter.api.assertThrows
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import org.junit.jupiter.params.provider.ValueSource

/**
 * Checks the roles from the local Docker init (the role script as a non-superuser owner) and their
 * rights on the tables that V1 creates.
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
                    WHERE rolname IN ($SCRIPT_ROLES_SQL_LIST)
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
                    "SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = ?",
                    schema,
                )
            }

        assertEquals(MIGRATE, schemaOwner)
    }

    @Test
    fun tables_areOwnedByMigrate() {
        val tableOwners =
            connectAs(SUPERUSER).use {
                it.queryRows(
                    """
                    SELECT schemaname || '.' || tablename || ': ' || tableowner
                    FROM pg_tables WHERE schemaname IN ('ledger', 'account')
                    """
                )
            }

        assertEquals(
            (APP_TABLES + HISTORY_TABLE).map { "$it: $MIGRATE" }.toSet(),
            tableOwners,
        )
    }

    @Test
    fun initShellScripts_areExecutable() {
        val shellScripts =
            TestDatabase.dockerPostgresDir.resolve("init").listDirectoryEntries().filter {
                it.extension == "sh"
            }

        assertTrue(shellScripts.isNotEmpty())
        shellScripts.forEach { script ->
            assertTrue(Files.isExecutable(script), "$script is not executable")
        }
    }

    @Test
    fun firstMigration_appliesV1() {
        assertEquals(1, TestDatabase.firstMigration.migrationsExecuted)
        assertEquals("1", TestDatabase.firstMigration.targetSchemaVersion)
    }

    @Test
    fun secondMigration_appliesNothing() {
        assertEquals(0, TestDatabase.migrate().migrationsExecuted)
    }

    @ParameterizedTest
    @ValueSource(strings = [APP, LEDGER_READER_LOGIN])
    fun flywayHistory_grantsNoRightsToRuntimeRoles(role: String) {
        val rights =
            connectAs(SUPERUSER).use { superuser ->
                listOf("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE").filter { privilege ->
                    superuser.queryString(
                        "SELECT has_table_privilege(?, '$HISTORY_TABLE', ?)",
                        role,
                        privilege,
                    ) == "t"
                }
            }

        assertEquals(emptyList<String>(), rights)
    }

    @ParameterizedTest
    @ValueSource(
        strings =
            [
                "account.app_user",
                "account.user_settings",
                "ledger.node",
                "ledger.cycle",
                "ledger.estimate",
            ]
    )
    fun app_select_succeeds(table: String) {
        connectAs(APP).use { assertDoesNotThrow { it.execute("SELECT count(*) FROM $table") } }
    }

    @Test
    fun app_insertIntoEveryTable_succeeds() {
        connectAs(APP).use { app ->
            val fixtures = LedgerFixtures(app)
            val userId = fixtures.newUser()
            val nodeId = fixtures.newNode(userId)

            assertDoesNotThrow {
                app.execute("INSERT INTO account.user_settings (user_id) VALUES (?)", userId)
                app.execute(
                    "INSERT INTO ledger.estimate (user_id, node_id, mode, cycle_minutes, cycle_count) VALUES (?, ?, 'shallow', 25, 2)",
                    userId,
                    nodeId,
                )
                fixtures.newCycle(userId, nodeId, minutes = 25)
            }
        }
    }

    @ParameterizedTest
    @CsvSource(
        "account.app_user, email",
        "account.user_settings, sound_enabled",
        "ledger.node, name",
        "ledger.cycle, minutes",
        "ledger.estimate, cycle_count",
    )
    fun app_update_succeeds(table: String, column: String) {
        connectAs(APP).use {
            assertDoesNotThrow { it.execute("UPDATE $table SET $column = $column WHERE false") }
        }
    }

    @ParameterizedTest
    @ValueSource(
        strings =
            [
                "account.app_user",
                "account.user_settings",
                "ledger.node",
                "ledger.cycle",
                "ledger.estimate",
            ]
    )
    fun app_delete_isDenied(table: String) {
        connectAs(APP).use { it.assertDenied("DELETE FROM $table WHERE false") }
    }

    @ParameterizedTest
    @ValueSource(
        strings =
            [
                "account.app_user",
                "account.user_settings",
                "ledger.node",
                "ledger.cycle",
                "ledger.estimate",
            ]
    )
    fun app_truncate_isDenied(table: String) {
        connectAs(APP).use { it.assertDenied("TRUNCATE $table") }
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
    fun ledgerReaderLogin_selectFromLedger_succeeds() {
        connectAs(LEDGER_READER_LOGIN).use {
            assertDoesNotThrow { it.execute("SELECT count(*) FROM ledger.node") }
        }
    }

    @Test
    fun ledgerReaderLogin_insertIntoLedger_isDenied() {
        connectAs(LEDGER_READER_LOGIN).use {
            it.assertDenied(
                "INSERT INTO ledger.node (user_id, request_id, name) VALUES (gen_random_uuid(), gen_random_uuid(), 'x')"
            )
        }
    }

    @Test
    fun ledgerReaderLogin_selectFromAccount_isDenied() {
        connectAs(LEDGER_READER_LOGIN).use {
            it.assertDenied("SELECT count(*) FROM account.app_user")
        }
    }

    @Test
    fun roleWithoutGrants_connect_isDenied() {
        val error = assertThrows<SQLException> { connectAs(UNGRANTED_LOGIN) }

        assertEquals(TestDatabase.INSUFFICIENT_PRIVILEGE, error.sqlState)
    }

    companion object {
        private const val LEDGER_READER_LOGIN = "ledger_reader_login"
        private const val UNGRANTED_LOGIN = "ungranted_login"
        private const val HISTORY_TABLE = "ledger.flyway_schema_history"

        private val APP_TABLES =
            listOf(
                "account.app_user",
                "account.user_settings",
                "ledger.node",
                "ledger.cycle",
                "ledger.estimate",
            )

        private val SCRIPT_ROLES_SQL_LIST =
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

        @JvmStatic
        @BeforeAll
        fun createHelperLogins() {
            connectAs(SUPERUSER).use { superuser ->
                superuser.execute("CREATE ROLE $UNGRANTED_LOGIN LOGIN")
                superuser.execute("CREATE ROLE $LEDGER_READER_LOGIN LOGIN IN ROLE ledger_reader")
            }
        }
    }
}
