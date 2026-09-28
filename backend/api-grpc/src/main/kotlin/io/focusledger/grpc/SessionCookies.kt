package io.focusledger.grpc

import com.nimbusds.jose.JOSEException
import com.nimbusds.jose.JWSAlgorithm
import com.nimbusds.jose.JWSHeader
import com.nimbusds.jose.crypto.MACSigner
import com.nimbusds.jose.crypto.MACVerifier
import com.nimbusds.jwt.JWTClaimsSet
import com.nimbusds.jwt.SignedJWT
import io.focusledger.core.UserId
import java.text.ParseException
import java.time.Clock
import java.time.Duration
import java.util.Date
import java.util.UUID

/** A valid session: the user, and whether the cookie is old enough to renew. */
data class Session(val userId: UserId, val shouldRenew: Boolean)

/**
 * The signed session cookie from docs/api.md, "Sessions": it holds the user ID, the issue time, and
 * the expiry, signed with HMAC-SHA256. There is no session table.
 */
class SessionCookies(signingKey: ByteArray, private val clock: Clock) {
    private val signer = MACSigner(signingKey)
    private val verifier = MACVerifier(signingKey)

    init {
        require(signingKey.size >= MIN_KEY_BYTES) {
            "The session signing key must be at least $MIN_KEY_BYTES bytes."
        }
    }

    /** The Set-Cookie value that starts a 30-day session for [userId]. */
    fun issue(userId: UserId): String {
        val now = clock.instant()
        val claims =
            JWTClaimsSet.Builder()
                .subject(userId.value.toString())
                .issueTime(Date.from(now))
                .expirationTime(Date.from(now.plus(LIFETIME)))
                .build()
        val token =
            SignedJWT(JWSHeader(JWSAlgorithm.HS256), claims).apply { sign(signer) }.serialize()
        return "$NAME=$token; Max-Age=${LIFETIME.seconds}; $ATTRIBUTES"
    }

    /** The Set-Cookie value that clears the session in the browser. */
    fun clear(): String = "$NAME=; Max-Age=0; $ATTRIBUTES"

    /**
     * The session in [cookieHeader], or null when there is none, or it is expired or not signed by
     * us.
     */
    fun read(cookieHeader: String?): Session? {
        val token = cookieValue(cookieHeader) ?: return null
        val claims =
            try {
                SignedJWT.parse(token)
                    .takeIf { it.header.algorithm == JWSAlgorithm.HS256 && it.verify(verifier) }
                    ?.jwtClaimsSet
            } catch (_: ParseException) {
                null
            } catch (_: JOSEException) {
                null
            } ?: return null
        val now = clock.instant()
        val expiresAt = claims.expirationTime?.toInstant() ?: return null
        val issuedAt = claims.issueTime?.toInstant() ?: return null
        if (!now.isBefore(expiresAt)) return null
        val userId = runCatching { UUID.fromString(claims.subject) }.getOrNull() ?: return null
        return Session(UserId(userId), shouldRenew = Duration.between(issuedAt, now) > RENEW_AFTER)
    }

    private fun cookieValue(cookieHeader: String?): String? =
        cookieHeader
            ?.split(';')
            ?.map { it.trim() }
            ?.firstOrNull { it.startsWith("$NAME=") }
            ?.removePrefix("$NAME=")
            ?.takeIf { it.isNotEmpty() }

    companion object {
        const val NAME = "session"
        private const val ATTRIBUTES = "Path=/; HttpOnly; Secure; SameSite=Lax"
        private const val MIN_KEY_BYTES = 32
        val LIFETIME: Duration = Duration.ofDays(30)
        val RENEW_AFTER: Duration = Duration.ofDays(1)
    }
}
