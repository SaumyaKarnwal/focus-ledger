package io.focusledger.data

import io.focusledger.core.UserId
import io.focusledger.core.account.AgentConnectionId
import io.focusledger.data.TestDatabase.APP
import io.focusledger.data.TestDatabase.CHECK_VIOLATION
import io.focusledger.data.TestDatabase.FOREIGN_KEY_VIOLATION
import io.focusledger.data.TestDatabase.connectAs
import java.sql.SQLException
import java.util.UUID
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

class JdbcAgentConnectionRepositoryTest {
    private val repository = JdbcAgentConnectionRepository(TestDatabase.dataSourceAs(APP))
    private val app = connectAs(APP)
    private val userA = UserId(LedgerFixtures(app).newUser())
    private val userB = UserId(LedgerFixtures(app).newUser())
    private val clientId = "https://agent.example/client.json"
    private val firstHash = hash(1)
    private val secondHash = hash(2)

    @AfterEach fun closeConnection() = app.close()

    private fun hash(seed: Int) = ByteArray(32) { seed.toByte() }

    private fun storedHash(connectionId: AgentConnectionId): String? =
        app.queryString(
            "SELECT encode(refresh_token_hash, 'hex') FROM account.agent_connection WHERE id = ?",
            connectionId.value,
        )

    @Test
    fun insert_returnsAnActiveConnectionThatFindReturns() {
        val inserted = repository.insert(userA, clientId, firstHash)

        assertEquals(userA, inserted.userId)
        assertEquals(clientId, inserted.clientId)
        assertNull(inserted.revokedAt)
        assertEquals(inserted, repository.find(userA, inserted.id))
        assertEquals("01".repeat(32), storedHash(inserted.id))
    }

    @Test
    fun rotate_withTheCurrentHash_replacesIt() {
        val connection = repository.insert(userA, clientId, firstHash)

        assertTrue(repository.rotateRefreshSecret(userA, connection.id, firstHash, secondHash))
        assertEquals("02".repeat(32), storedHash(connection.id))
    }

    @Test
    fun rotate_withAnOldHash_changesNothing() {
        val connection = repository.insert(userA, clientId, firstHash)
        repository.rotateRefreshSecret(userA, connection.id, firstHash, secondHash)

        assertFalse(repository.rotateRefreshSecret(userA, connection.id, firstHash, hash(3)))
        assertEquals("02".repeat(32), storedHash(connection.id))
    }

    @Test
    fun rotate_onARevokedConnection_changesNothing() {
        val connection = repository.insert(userA, clientId, firstHash)
        repository.revoke(userA, connection.id)

        assertFalse(repository.rotateRefreshSecret(userA, connection.id, firstHash, secondHash))
        assertEquals("01".repeat(32), storedHash(connection.id))
    }

    @Test
    fun revoke_setsRevokedAtOnce() {
        val connection = repository.insert(userA, clientId, firstHash)

        assertTrue(repository.revoke(userA, connection.id))
        val revokedAt = repository.find(userA, connection.id)?.revokedAt
        assertNotNull(revokedAt)
        assertFalse(repository.revoke(userA, connection.id))
        assertEquals(revokedAt, repository.find(userA, connection.id)?.revokedAt)
    }

    @Test
    fun missingConnection_isNotFound() {
        val unknown = AgentConnectionId(UUID.randomUUID())

        assertNull(repository.find(userA, unknown))
        assertFalse(repository.rotateRefreshSecret(userA, unknown, firstHash, secondHash))
        assertFalse(repository.revoke(userA, unknown))
    }

    @Test
    fun userIsolation_userBCannotReadRotateOrRevokeUserAsConnection() {
        val connectionOfA = repository.insert(userA, clientId, firstHash)

        assertNull(repository.find(userB, connectionOfA.id))
        assertFalse(repository.rotateRefreshSecret(userB, connectionOfA.id, firstHash, secondHash))
        assertFalse(repository.revoke(userB, connectionOfA.id))
        assertEquals(connectionOfA, repository.find(userA, connectionOfA.id))
        assertEquals("01".repeat(32), storedHash(connectionOfA.id))
    }

    @Test
    fun insert_forAMissingUser_isRejected() {
        val error =
            assertThrows<SQLException> {
                repository.insert(UserId(UUID.randomUUID()), clientId, firstHash)
            }

        assertEquals(FOREIGN_KEY_VIOLATION, error.sqlState)
    }

    @Test
    fun insert_withAHashThatIsNot32Bytes_isRejected() {
        val error = assertThrows<SQLException> { repository.insert(userA, clientId, ByteArray(16)) }

        assertEquals(CHECK_VIOLATION, error.sqlState)
    }

    @Test
    fun app_delete_isDenied() {
        repository.insert(userA, clientId, firstHash)

        app.assertDenied("DELETE FROM account.agent_connection WHERE user_id = ?", userA.value)
    }
}
