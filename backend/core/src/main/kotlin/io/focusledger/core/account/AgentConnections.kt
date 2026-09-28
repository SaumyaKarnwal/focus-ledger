package io.focusledger.core.account

import io.focusledger.core.UserId
import java.time.Instant
import java.util.UUID

@JvmInline value class AgentConnectionId(val value: UUID)

/** One agent app that a user connected through OAuth. */
data class AgentConnection(
    val id: AgentConnectionId,
    val userId: UserId,
    /** The URL of the app's Client ID Metadata Document. */
    val clientId: String,
    val createdAt: Instant,
    /** Null means the connection is active. */
    val revokedAt: Instant?,
)

/**
 * The agent connections of one user. Every function filters by [UserId]. The table keeps only the
 * SHA-256 of the current refresh token's secret, never the token itself.
 */
interface AgentConnectionRepository {
    fun insert(userId: UserId, clientId: String, refreshSecretHash: ByteArray): AgentConnection

    /** The connection, active or revoked, or null when this user has none with that ID. */
    fun find(userId: UserId, connectionId: AgentConnectionId): AgentConnection?

    /**
     * Replaces the hash only when [expectedHash] is still current and the connection is active.
     * False means an old refresh token, another refresh that won the race, or a revoked connection.
     */
    fun rotateRefreshSecret(
        userId: UserId,
        connectionId: AgentConnectionId,
        expectedHash: ByteArray,
        newHash: ByteArray,
    ): Boolean

    /** Sets `revoked_at` once. False when this user has no active connection with that ID. */
    fun revoke(userId: UserId, connectionId: AgentConnectionId): Boolean
}
