package io.focusledger.data

import io.focusledger.core.UserId
import io.focusledger.core.account.AgentConnection
import io.focusledger.core.account.AgentConnectionId
import io.focusledger.core.account.AgentConnectionRepository
import java.sql.Connection
import java.sql.ResultSet
import java.time.OffsetDateTime
import java.util.UUID
import javax.sql.DataSource

/** Plain JDBC until the jOOQ code generation from #40 is on main. Each call is one statement. */
class JdbcAgentConnectionRepository(private val dataSource: DataSource) :
    AgentConnectionRepository {
    override fun insert(
        userId: UserId,
        clientId: String,
        refreshSecretHash: ByteArray,
    ): AgentConnection =
        query(
                """
                INSERT INTO account.agent_connection (user_id, client_id, refresh_token_hash)
                VALUES (?, ?, ?) RETURNING $COLUMNS
                """,
                userId.value,
                clientId,
                refreshSecretHash,
            )
            .single()

    override fun find(userId: UserId, connectionId: AgentConnectionId): AgentConnection? =
        query(
                "SELECT $COLUMNS FROM account.agent_connection WHERE user_id = ? AND id = ?",
                userId.value,
                connectionId.value,
            )
            .singleOrNull()

    override fun rotateRefreshSecret(
        userId: UserId,
        connectionId: AgentConnectionId,
        expectedHash: ByteArray,
        newHash: ByteArray,
    ): Boolean =
        update(
            """
            UPDATE account.agent_connection SET refresh_token_hash = ?
            WHERE user_id = ? AND id = ? AND refresh_token_hash = ? AND revoked_at IS NULL
            """,
            newHash,
            userId.value,
            connectionId.value,
            expectedHash,
        ) == 1

    override fun revoke(userId: UserId, connectionId: AgentConnectionId): Boolean =
        update(
            """
            UPDATE account.agent_connection SET revoked_at = now()
            WHERE user_id = ? AND id = ? AND revoked_at IS NULL
            """,
            userId.value,
            connectionId.value,
        ) == 1

    private fun query(sql: String, vararg parameters: Any): List<AgentConnection> =
        dataSource.connection.use { connection ->
            connection.statement(sql, parameters).use { statement ->
                statement.executeQuery().use { rows ->
                    generateSequence { if (rows.next()) rows.toAgentConnection() else null }
                        .toList()
                }
            }
        }

    private fun update(sql: String, vararg parameters: Any): Int =
        dataSource.connection.use { connection ->
            connection.statement(sql, parameters).use { it.executeUpdate() }
        }

    private fun Connection.statement(sql: String, parameters: Array<out Any>) =
        prepareStatement(sql).apply {
            parameters.forEachIndexed { index, value -> setObject(index + 1, value) }
        }

    private fun ResultSet.toAgentConnection() =
        AgentConnection(
            id = AgentConnectionId(getObject("id", UUID::class.java)),
            userId = UserId(getObject("user_id", UUID::class.java)),
            clientId = getString("client_id"),
            createdAt = getObject("created_at", OffsetDateTime::class.java).toInstant(),
            revokedAt = getObject("revoked_at", OffsetDateTime::class.java)?.toInstant(),
        )

    private companion object {
        const val COLUMNS = "id, user_id, client_id, created_at, revoked_at"
    }
}
