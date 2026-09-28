package io.focusledger.mcp.oauth

import com.nimbusds.jose.JOSEException
import com.nimbusds.jose.JOSEObjectType
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

/**
 * The kinds of signed token. Each kind has its own JOSE `typ` and its own audience, so a token of
 * one kind is never accepted as another.
 */
internal enum class TokenKind(val joseType: String) {
    ACCESS("at+jwt"),
    LOGIN_CODE("focusledger-code+jwt"),
    CONSENT("focusledger-consent+jwt"),
}

/** The checked claims of a signed token. */
internal class VerifiedToken(val userId: UserId, private val claims: JWTClaimsSet) {
    val tokenId: String = claims.jwtid
    val expiresAt = claims.expirationTime.toInstant()

    fun string(name: String): String? = claims.getStringClaim(name)

    /** A claim that the server always signs into this kind of token. */
    fun requireClaim(name: String): String =
        checkNotNull(string(name)) { "The signed token has no $name claim." }
}

/** HS256 JWTs with MCP_TOKEN_SIGNING_KEY, through Nimbus JOSE+JWT. */
internal class SignedTokens(private val config: OAuthConfig, private val clock: Clock) {
    private val signer = MACSigner(config.signingKey)
    private val verifier = MACVerifier(config.signingKey)

    fun sign(
        kind: TokenKind,
        userId: UserId,
        audience: String,
        lifetime: Duration,
        claims: Map<String, String>,
    ): String {
        val now = clock.instant()
        val claimSet =
            claims.entries
                .fold(JWTClaimsSet.Builder()) { builder, (name, value) ->
                    builder.claim(name, value)
                }
                .issuer(config.issuer)
                .subject(userId.value.toString())
                .audience(audience)
                .issueTime(Date.from(now))
                .expirationTime(Date.from(now.plus(lifetime)))
                .jwtID(UUID.randomUUID().toString())
                .build()
        val header =
            JWSHeader.Builder(JWSAlgorithm.HS256).type(JOSEObjectType(kind.joseType)).build()
        return SignedJWT(header, claimSet).apply { sign(signer) }.serialize()
    }

    /** The claims, or null when the token is malformed, of another kind, forged, or expired. */
    fun verify(token: String, kind: TokenKind, audience: String): VerifiedToken? =
        try {
            val jwt = SignedJWT.parse(token)
            val claims = jwt.jwtClaimsSet
            val valid =
                jwt.header.algorithm == JWSAlgorithm.HS256 &&
                    jwt.header.type == JOSEObjectType(kind.joseType) &&
                    jwt.verify(verifier) &&
                    claims.issuer == config.issuer &&
                    claims.audience == listOf(audience) &&
                    claims.expirationTime?.toInstant()?.isAfter(clock.instant()) == true &&
                    claims.jwtid != null &&
                    claims.subject != null
            if (valid) VerifiedToken(UserId(UUID.fromString(claims.subject)), claims) else null
        } catch (_: ParseException) {
            null
        } catch (_: JOSEException) {
            null
        } catch (_: IllegalArgumentException) {
            null
        }
}
