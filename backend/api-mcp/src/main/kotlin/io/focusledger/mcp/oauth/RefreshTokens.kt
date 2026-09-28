package io.focusledger.mcp.oauth

import io.focusledger.core.UserId
import io.focusledger.core.account.AgentConnectionId
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Clock
import java.time.Instant
import java.util.Base64
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * An opaque refresh token: `<user_id>.<connection_id>.<secret>`, where the secret is 32 random
 * bytes in base64url. The IDs let the server find the row by user and ID. Only the SHA-256 of the
 * secret is stored.
 */
internal class RefreshToken(
    val userId: UserId,
    val connectionId: AgentConnectionId,
    private val secret: ByteArray,
) {
    val secretHash: ByteArray
        get() = sha256(secret)

    /** The text that the agent receives. */
    fun encoded(): String =
        "${userId.value}.${connectionId.value}.${base64Url.encodeToString(secret)}"

    /** Leaves out the secret, so a log line cannot leak it. */
    override fun toString(): String = "RefreshToken(connection=${connectionId.value})"

    companion object {
        private const val SECRET_BYTES = 32
        private val random = SecureRandom()
        private val base64Url = Base64.getUrlEncoder().withoutPadding()

        fun newSecret(): ByteArray = ByteArray(SECRET_BYTES).also(random::nextBytes)

        fun sha256(bytes: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(bytes)

        /** The token's parts, or null when the text has the wrong shape. */
        fun parse(text: String): RefreshToken? {
            val parts = text.split('.')
            if (parts.size != 3) return null
            return try {
                RefreshToken(
                    UserId(UUID.fromString(parts[0])),
                    AgentConnectionId(UUID.fromString(parts[1])),
                    Base64.getUrlDecoder().decode(parts[2]).takeIf { it.size == SECRET_BYTES }
                        ?: return null,
                )
            } catch (_: IllegalArgumentException) {
                null
            }
        }
    }
}

/**
 * The login codes that were already redeemed, until they expire. The service runs one instance, so
 * an in-memory set is enough (docs/mcp.md).
 */
internal class RedeemedCodes(private val clock: Clock) {
    private data class Redeemed(
        val expiresAt: Instant,
        val connection: Pair<UserId, AgentConnectionId>?,
        val reused: Boolean,
    )

    sealed interface Redemption {
        data object First : Redemption

        /** [connection] is the one that the first redemption created, if it got that far. */
        data class Reused(val connection: Pair<UserId, AgentConnectionId>?) : Redemption
    }

    private val redeemed = ConcurrentHashMap<String, Redeemed>()

    /** [Redemption.First] the first time for [codeId]. Every later call marks the code reused. */
    fun redeem(codeId: String, expiresAt: Instant): Redemption {
        val now = clock.instant()
        redeemed.entries.removeIf { it.value.expiresAt.isBefore(now) }
        var redemption: Redemption = Redemption.First
        redeemed.compute(codeId) { _, entry ->
            if (entry == null) {
                Redeemed(expiresAt, connection = null, reused = false)
            } else {
                redemption = Redemption.Reused(entry.connection)
                entry.copy(reused = true)
            }
        }
        return redemption
    }

    /**
     * Records the connection that the first redemption created, so a later reuse can revoke it.
     * False when a reuse came first: then the caller revokes the connection itself.
     */
    fun recordConnection(codeId: String, userId: UserId, connectionId: AgentConnectionId): Boolean {
        var recorded = false
        redeemed.computeIfPresent(codeId) { _, entry ->
            recorded = !entry.reused
            entry.copy(connection = userId to connectionId)
        }
        return recorded
    }
}
