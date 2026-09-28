package io.focusledger.mcp.oauth

import io.focusledger.core.UserId
import io.focusledger.core.account.AgentConnection
import io.focusledger.core.account.AgentConnectionId
import io.focusledger.core.account.AgentConnectionRepository
import java.time.Clock
import java.util.UUID

/** An in-memory [AgentConnectionRepository] with the same filters as the JDBC one. */
class InMemoryAgentConnections(private val clock: Clock) : AgentConnectionRepository {
    private data class Row(val connection: AgentConnection, val hash: ByteArray)

    private val rows = mutableMapOf<AgentConnectionId, Row>()

    fun all(): List<AgentConnection> = synchronized(rows) { rows.values.map { it.connection } }

    override fun insert(
        userId: UserId,
        clientId: String,
        refreshSecretHash: ByteArray,
    ): AgentConnection =
        synchronized(rows) {
            val connection =
                AgentConnection(
                    AgentConnectionId(UUID.randomUUID()),
                    userId,
                    clientId,
                    clock.instant(),
                    revokedAt = null,
                )
            rows[connection.id] = Row(connection, refreshSecretHash)
            connection
        }

    override fun find(userId: UserId, connectionId: AgentConnectionId): AgentConnection? =
        synchronized(rows) { rows[connectionId]?.connection?.takeIf { it.userId == userId } }

    override fun rotateRefreshSecret(
        userId: UserId,
        connectionId: AgentConnectionId,
        expectedHash: ByteArray,
        newHash: ByteArray,
    ): Boolean =
        synchronized(rows) {
            val row = rows[connectionId]
            val current =
                row != null &&
                    row.connection.userId == userId &&
                    row.connection.revokedAt == null &&
                    row.hash.contentEquals(expectedHash)
            if (current) rows[connectionId] = row.copy(hash = newHash)
            current
        }

    override fun revoke(userId: UserId, connectionId: AgentConnectionId): Boolean =
        synchronized(rows) {
            val row = rows[connectionId]
            val active =
                row != null && row.connection.userId == userId && row.connection.revokedAt == null
            if (active) {
                rows[connectionId] =
                    row.copy(connection = row.connection.copy(revokedAt = clock.instant()))
            }
            active
        }
}
