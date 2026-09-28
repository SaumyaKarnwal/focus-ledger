package io.focusledger.data

import io.focusledger.data.TestDatabase.APP
import io.focusledger.data.TestDatabase.CHECK_VIOLATION
import io.focusledger.data.TestDatabase.FOREIGN_KEY_VIOLATION
import io.focusledger.data.TestDatabase.MIGRATE
import io.focusledger.data.TestDatabase.NOT_NULL_VIOLATION
import io.focusledger.data.TestDatabase.UNIQUE_VIOLATION
import io.focusledger.data.TestDatabase.connectAs
import java.sql.Connection
import java.util.UUID
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertDoesNotThrow
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource

/**
 * The checks in docs/schema.md, "Verification", on V1. The test names carry the check numbers.
 * Checks 13, 14, and 18 run as the table owner, because the app role has no DELETE. Check 15 is a
 * server rule and belongs to the UpdateCycle tests.
 */
class SchemaChecksTest {

    private val app: Connection = connectAs(APP)
    private val fixtures = LedgerFixtures(app)

    @AfterEach
    fun closeConnection() {
        app.close()
    }

    @Test
    fun check01_nodeWithParentOfAnotherUser_isRejected() {
        val otherUsersNode = fixtures.newNode(fixtures.newUser())
        val userId = fixtures.newUser()

        app.assertFails(
            FOREIGN_KEY_VIOLATION,
            "INSERT INTO ledger.node (user_id, request_id, parent_id, name) VALUES (?, ?, ?, 'x')",
            userId,
            UUID.randomUUID(),
            otherUsersNode,
        )
    }

    @Test
    fun check02_moveUnderOwnDescendant_isRejected() {
        val userId = fixtures.newUser()
        val root = fixtures.newNode(userId)
        val child = fixtures.newNode(userId, parentId = root)
        val grandchild = fixtures.newNode(userId, parentId = child)

        app.assertFails(
            CHECK_VIOLATION,
            "UPDATE ledger.node SET parent_id = ? WHERE user_id = ? AND id = ?",
            grandchild,
            userId,
            root,
        )
    }

    @Test
    fun check03_legalMove_isAccepted() {
        val userId = fixtures.newUser()
        val first = fixtures.newNode(userId)
        val second = fixtures.newNode(userId)
        val child = fixtures.newNode(userId, parentId = first)

        app.execute(
            "UPDATE ledger.node SET parent_id = ? WHERE user_id = ? AND id = ?",
            second,
            userId,
            child,
        )

        assertEquals(
            second.toString(),
            app.queryString(
                "SELECT parent_id FROM ledger.node WHERE user_id = ? AND id = ?",
                userId,
                child,
            ),
        )
    }

    @Test
    fun check04_start_writesRowWithNullMinutes() {
        val userId = fixtures.newUser()
        val cycleId = fixtures.newCycle(userId)

        assertNull(minutesOf(userId, cycleId))
    }

    @Test
    fun check05_secondRunningCycle_isRejected() {
        val userId = fixtures.newUser()
        fixtures.newCycle(userId)

        app.assertFails(UNIQUE_VIOLATION, INSERT_RUNNING_CYCLE, userId, UUID.randomUUID())
    }

    @Test
    fun check06_stop_setsMinutes() {
        val userId = fixtures.newUser()
        val cycleId = fixtures.newCycle(userId)

        setMinutes(userId, cycleId, 50)

        assertEquals("50", minutesOf(userId, cycleId))
    }

    @Test
    fun check07_extension_growsMinutesAndKeepsPlannedMinutes() {
        val userId = fixtures.newUser()
        val cycleId = fixtures.newCycle(userId, minutes = 50, plannedMinutes = 50)

        setMinutes(userId, cycleId, 65)

        assertEquals("65", minutesOf(userId, cycleId))
        assertEquals(
            "50",
            app.queryString(
                "SELECT planned_minutes FROM ledger.cycle WHERE user_id = ? AND id = ?",
                userId,
                cycleId,
            ),
        )
    }

    @Test
    fun check08_minutesReduced_isRejected() {
        val userId = fixtures.newUser()
        val cycleId = fixtures.newCycle(userId, minutes = 50)

        app.assertFails(CHECK_VIOLATION, UPDATE_MINUTES, 49, userId, cycleId)
    }

    @Test
    fun check09_minutesSetBackToNull_isRejected() {
        val userId = fixtures.newUser()
        val cycleId = fixtures.newCycle(userId, minutes = 50)

        app.assertFails(CHECK_VIOLATION, UPDATE_MINUTES, null, userId, cycleId)
    }

    @Test
    fun check10_modeChange_isRejected() {
        val userId = fixtures.newUser()
        val cycleId = fixtures.newCycle(userId, minutes = 50)

        app.assertFails(
            CHECK_VIOLATION,
            "UPDATE ledger.cycle SET mode = 'shallow' WHERE user_id = ? AND id = ?",
            userId,
            cycleId,
        )
    }

    @Test
    fun check11_plannedMinutesChange_isRejected() {
        val userId = fixtures.newUser()
        val cycleId = fixtures.newCycle(userId, minutes = 50)

        app.assertFails(
            CHECK_VIOLATION,
            "UPDATE ledger.cycle SET planned_minutes = 60 WHERE user_id = ? AND id = ?",
            userId,
            cycleId,
        )
    }

    @Test
    fun check12_filingInboxCycle_isAcceptedOnce() {
        val userId = fixtures.newUser()
        val firstNode = fixtures.newNode(userId)
        val secondNode = fixtures.newNode(userId)
        val cycleId = fixtures.newCycle(userId, minutes = 50)

        assertDoesNotThrow { app.execute(UPDATE_NODE_ID, firstNode, userId, cycleId) }
        app.assertFails(CHECK_VIOLATION, UPDATE_NODE_ID, secondNode, userId, cycleId)
    }

    @ParameterizedTest
    @CsvSource("logged, 50", "running, ")
    fun check13and14_cycleDelete_isRejectedByTriggerForOwnerAndByPrivilegeForApp(
        state: String,
        minutes: Int?,
    ) {
        val userId = fixtures.newUser()
        val cycleId = fixtures.newCycle(userId, minutes = minutes)

        connectAs(MIGRATE).use { owner ->
            owner.assertFails(CHECK_VIOLATION, DELETE_CYCLE, userId, cycleId)
        }
        app.assertDenied(DELETE_CYCLE, userId, cycleId)
        assertEquals(
            "1",
            app.queryString(
                "SELECT count(*) FROM ledger.cycle WHERE user_id = ? AND id = ?",
                userId,
                cycleId,
            ),
            state,
        )
    }

    @Test
    fun check16_cycleOfZeroMinutes_isRejected() {
        val userId = fixtures.newUser()

        app.assertFails(
            CHECK_VIOLATION,
            """
            INSERT INTO ledger.cycle (user_id, request_id, mode, started_at, planned_minutes, minutes)
            VALUES (?, ?, 'execution', now(), 50, 0)
            """,
            userId,
            UUID.randomUUID(),
        )
    }

    @ParameterizedTest
    @CsvSource("America/Los_Angeles, 2026-09-24", "Asia/Kolkata, 2026-09-25")
    fun check17_dayOfUtcMoment_dependsOnZone(zone: String, expectedDay: String) {
        val day =
            app.queryString(
                "SELECT (timestamptz '2026-09-25 02:00:00+00' AT TIME ZONE ?)::date",
                zone,
            )

        assertEquals(expectedDay, day)
    }

    @Test
    fun check18_accountDelete_asOwnerRemovesAllRowsAndAsAppIsDenied() {
        val userId = fixtures.newUser()
        val root = fixtures.newNode(userId)
        val child = fixtures.newNode(userId, parentId = root)
        app.execute("INSERT INTO account.user_settings (user_id) VALUES (?)", userId)
        app.execute(
            "INSERT INTO ledger.estimate (user_id, node_id, mode, cycle_minutes, cycle_count) VALUES (?, ?, 'deep_focus', 90, 2)",
            userId,
            child,
        )
        fixtures.newCycle(userId, nodeId = child, minutes = 90)
        fixtures.newCycle(userId, nodeId = root)
        val otherUserId = fixtures.newUser()
        fixtures.newCycle(otherUserId, minutes = 25)

        app.assertDenied(DELETE_ACCOUNT, userId)
        assertEquals(ROWS_BEFORE_DELETE, rowCounts(userId))

        connectAs(MIGRATE).use { owner -> owner.execute(DELETE_ACCOUNT, userId) }

        assertEquals(ROWS_AFTER_DELETE, rowCounts(userId))
        assertEquals(
            "1",
            app.queryString("SELECT count(*) FROM ledger.cycle WHERE user_id = ?", otherUserId),
        )
    }

    @Test
    fun check19_sameEmailInOtherCase_isRejected() {
        val email = "${UUID.randomUUID()}@Example.com"
        fixtures.newUser(email)

        app.assertFails(
            UNIQUE_VIOLATION,
            "INSERT INTO account.app_user (email) VALUES (?)",
            email.lowercase(),
        )
    }

    @Test
    fun emailLookup_withCitextParameter_ignoresCase() {
        val email = "${UUID.randomUUID()}@Example.com"
        val userId = fixtures.newUser(email)

        val foundIds =
            app.queryColumn(
                "SELECT id FROM account.app_user WHERE email = CAST(? AS citext)",
                email.uppercase(),
            )

        assertEquals(listOf(userId.toString()), foundIds)
    }

    /** pgjdbc binds a String as varchar, and citext = varchar compares as text. */
    @Test
    fun emailLookup_withPlainStringParameter_isCaseSensitive() {
        val email = "${UUID.randomUUID()}@Example.com"
        fixtures.newUser(email)

        val foundIds =
            app.queryColumn("SELECT id FROM account.app_user WHERE email = ?", email.uppercase())

        assertEquals(emptyList<String?>(), foundIds)
    }

    @Test
    fun check20_accountWithoutEmail_isRejected() {
        app.assertFails(NOT_NULL_VIOLATION, "INSERT INTO account.app_user (email) VALUES (NULL)")
    }

    @Test
    fun check21_repeatCreateCycleKey_insertsNothing() {
        val userId = fixtures.newUser()
        val requestId = UUID.randomUUID()
        fixtures.newCycle(userId, minutes = 25, requestId = requestId)

        val repeat = app.queryColumn(INSERT_LOGGED_CYCLE_IDEMPOTENT, userId, requestId)

        assertEquals(emptyList<String?>(), repeat)
        assertEquals("1", countByKey("ledger.cycle", userId, requestId))
    }

    @Test
    fun check22_sameKeyForAnotherUser_isAccepted() {
        val requestId = UUID.randomUUID()
        val firstUser = fixtures.newUser()
        val secondUser = fixtures.newUser()
        fixtures.newCycle(firstUser, minutes = 25, requestId = requestId)
        fixtures.newNode(firstUser, requestId = requestId)

        val cycleInsert = app.queryColumn(INSERT_LOGGED_CYCLE_IDEMPOTENT, secondUser, requestId)
        val nodeInsert = app.queryColumn(INSERT_NODE_IDEMPOTENT, secondUser, requestId)

        assertEquals(1, cycleInsert.size)
        assertEquals(1, nodeInsert.size)
    }

    @ParameterizedTest
    @CsvSource(
        "'INSERT INTO ledger.cycle (user_id, mode, started_at, planned_minutes) VALUES (?, ''shallow'', now(), 25)'",
        "'INSERT INTO ledger.node (user_id, name) VALUES (?, ''x'')'",
    )
    fun check23_createWithoutKey_isRejected(insertWithoutKey: String) {
        app.assertFails(NOT_NULL_VIOLATION, insertWithoutKey, fixtures.newUser())
    }

    @Test
    fun check24_repeatCreateNodeKey_insertsNothing() {
        val userId = fixtures.newUser()
        val requestId = UUID.randomUUID()
        fixtures.newNode(userId, requestId = requestId)

        val repeat = app.queryColumn(INSERT_NODE_IDEMPOTENT, userId, requestId)

        assertEquals(emptyList<String?>(), repeat)
        assertEquals("1", countByKey("ledger.node", userId, requestId))
    }

    @Test
    fun check25_requestIdChange_isRejected() {
        val userId = fixtures.newUser()
        val cycleId = fixtures.newCycle(userId, minutes = 25)

        app.assertFails(
            CHECK_VIOLATION,
            "UPDATE ledger.cycle SET request_id = ? WHERE user_id = ? AND id = ?",
            UUID.randomUUID(),
            userId,
            cycleId,
        )
    }

    @Test
    fun userSettingsUpdate_asApp_setsUpdatedAtThroughLedgerTrigger() {
        val userId = fixtures.newUser()
        app.execute(
            "INSERT INTO account.user_settings (user_id, updated_at) VALUES (?, '2000-01-01Z')",
            userId,
        )

        app.execute(
            "UPDATE account.user_settings SET sound_enabled = false WHERE user_id = ?",
            userId,
        )

        assertEquals(
            "t",
            app.queryString(
                "SELECT updated_at > '2000-01-01Z' FROM account.user_settings WHERE user_id = ?",
                userId,
            ),
        )
    }

    private fun minutesOf(userId: UUID, cycleId: UUID): String? =
        app.queryString(
            "SELECT minutes FROM ledger.cycle WHERE user_id = ? AND id = ?",
            userId,
            cycleId,
        )

    private fun setMinutes(userId: UUID, cycleId: UUID, minutes: Int) =
        app.execute(UPDATE_MINUTES, minutes, userId, cycleId)

    private fun countByKey(table: String, userId: UUID, requestId: UUID): String? =
        app.queryString(
            "SELECT count(*) FROM $table WHERE user_id = ? AND request_id = ?",
            userId,
            requestId,
        )

    private fun rowCounts(userId: UUID): Map<String, String?> =
        ACCOUNT_ROWS_BY_TABLE.mapValues { (_, userColumn) ->
            app.queryString(
                "SELECT count(*) FROM ${userColumn.first} WHERE ${userColumn.second} = ?",
                userId,
            )
        }

    companion object {
        private const val UPDATE_MINUTES =
            "UPDATE ledger.cycle SET minutes = ? WHERE user_id = ? AND id = ?"
        private const val UPDATE_NODE_ID =
            "UPDATE ledger.cycle SET node_id = ? WHERE user_id = ? AND id = ?"
        private const val DELETE_CYCLE = "DELETE FROM ledger.cycle WHERE user_id = ? AND id = ?"
        private const val DELETE_ACCOUNT = "DELETE FROM account.app_user WHERE id = ?"
        private const val INSERT_RUNNING_CYCLE =
            """
            INSERT INTO ledger.cycle (user_id, request_id, mode, started_at, planned_minutes)
            VALUES (?, ?, 'deep_focus', now(), 50)
            """
        private const val INSERT_LOGGED_CYCLE_IDEMPOTENT =
            """
            INSERT INTO ledger.cycle (user_id, request_id, mode, started_at, planned_minutes, minutes)
            VALUES (?, ?, 'shallow', now(), 25, 25)
            ON CONFLICT (user_id, request_id) DO NOTHING RETURNING id
            """
        private const val INSERT_NODE_IDEMPOTENT =
            """
            INSERT INTO ledger.node (user_id, request_id, name) VALUES (?, ?, 'Repeat')
            ON CONFLICT (user_id, request_id) DO NOTHING RETURNING id
            """

        /** Each table that holds an account's rows, with the column that names the account. */
        private val ACCOUNT_ROWS_BY_TABLE =
            mapOf(
                "app_user" to ("account.app_user" to "id"),
                "user_settings" to ("account.user_settings" to "user_id"),
                "node" to ("ledger.node" to "user_id"),
                "cycle" to ("ledger.cycle" to "user_id"),
                "estimate" to ("ledger.estimate" to "user_id"),
            )

        private val ROWS_BEFORE_DELETE =
            mapOf(
                "app_user" to "1",
                "user_settings" to "1",
                "node" to "2",
                "cycle" to "2",
                "estimate" to "1",
            )

        private val ROWS_AFTER_DELETE = ROWS_BEFORE_DELETE.mapValues { "0" }
    }
}
