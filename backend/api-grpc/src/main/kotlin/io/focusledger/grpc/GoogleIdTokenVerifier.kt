package io.focusledger.grpc

import com.nimbusds.jose.JWSAlgorithm
import com.nimbusds.jose.jwk.source.JWKSource
import com.nimbusds.jose.jwk.source.JWKSourceBuilder
import com.nimbusds.jose.proc.JWSVerificationKeySelector
import com.nimbusds.jose.proc.SecurityContext
import com.nimbusds.jwt.JWTClaimsSet
import com.nimbusds.jwt.proc.DefaultJWTClaimsVerifier
import com.nimbusds.jwt.proc.DefaultJWTProcessor
import io.focusledger.core.account.IdentityVerifier
import io.focusledger.core.account.SignInCredential
import io.focusledger.core.account.VerifiedIdentity
import java.net.URI

/**
 * Checks a Google ID token: the RS256 signature against [keys], the audience [clientId], a Google
 * issuer, and the expiry. See
 * https://developers.google.com/identity/gsi/web/guides/verify-google-id-token.
 */
class GoogleIdTokenVerifier(clientId: String, keys: JWKSource<SecurityContext>) : IdentityVerifier {
    private val processor =
        DefaultJWTProcessor<SecurityContext>().apply {
            jwsKeySelector = JWSVerificationKeySelector(JWSAlgorithm.RS256, keys)
            jwtClaimsSetVerifier =
                DefaultJWTClaimsVerifier(
                    clientId,
                    JWTClaimsSet.Builder().build(),
                    setOf("iss", "sub", "exp", "iat", "email"),
                )
        }

    override fun verify(credential: SignInCredential): VerifiedIdentity? {
        val token = (credential as? SignInCredential.GoogleIdToken)?.token ?: return null
        val claims = runCatching { processor.process(token, null) }.getOrNull() ?: return null
        if (claims.issuer !in ISSUERS) return null
        val email = claims.getStringClaim("email") ?: return null
        val verified = claims.getClaim("email_verified").let { it == true || it == "true" }
        return VerifiedIdentity(email, verified)
    }

    companion object {
        private val ISSUERS = setOf("accounts.google.com", "https://accounts.google.com")
        private val GOOGLE_KEYS = URI("https://www.googleapis.com/oauth2/v3/certs").toURL()

        /** The verifier with Google's published signing keys, fetched and cached by nimbus. */
        fun forGoogle(clientId: String): GoogleIdTokenVerifier =
            GoogleIdTokenVerifier(
                clientId,
                JWKSourceBuilder.create<SecurityContext>(GOOGLE_KEYS).build(),
            )
    }
}
