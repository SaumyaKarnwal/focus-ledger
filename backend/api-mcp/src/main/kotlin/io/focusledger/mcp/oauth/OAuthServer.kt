package io.focusledger.mcp.oauth

import io.focusledger.core.UserId
import io.focusledger.core.account.AgentConnectionRepository
import io.focusledger.mcp.BearerAuthenticator
import java.net.URLEncoder
import java.security.MessageDigest
import java.time.Clock
import java.util.Base64
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Reads the web app's session cookie. `app` wires in the cookie check of the gRPC side. */
fun interface BrowserSessions {
    /** The signed-in user, or null when the Cookie header has no valid session. */
    fun userId(cookieHeader: String?): UserId?
}

/** An authorization request whose client and redirect URI passed the checks. */
internal data class AuthorizationRequest(
    val client: ClientMetadata,
    val redirectUri: String,
    val codeChallenge: String,
    val state: String?,
    val resource: String,
)

internal sealed interface AuthorizationCheck {
    /** The client or the redirect URI is not trusted, so the server must not redirect. */
    data class ShowError(val message: String) : AuthorizationCheck

    data class Redirect(val url: String) : AuthorizationCheck

    data class Valid(val request: AuthorizationRequest) : AuthorizationCheck
}

internal sealed interface TokenResult {
    data class Issued(val body: JsonObject) : TokenResult

    data class Failed(val error: String, val description: String) : TokenResult
}

/**
 * The OAuth 2.1 authorization server for agents (docs/mcp.md, "Agent sign-in"). Access tokens and
 * login codes are signed JWTs. A refresh token is opaque, and each refresh replaces it.
 */
class OAuthServer(
    val config: OAuthConfig,
    private val connections: AgentConnectionRepository,
    private val clients: ClientMetadataSource,
    val sessions: BrowserSessions,
    private val clock: Clock = Clock.systemUTC(),
) : BearerAuthenticator {
    private val tokens = SignedTokens(config, clock)
    private val redeemedCodes = RedeemedCodes(clock)

    override fun authenticate(bearerToken: String): UserId? =
        tokens.verify(bearerToken, TokenKind.ACCESS, config.resource)?.userId

    internal fun protectedResourceMetadata(): JsonObject = buildJsonObject {
        put("resource", config.resource)
        putStrings("authorization_servers", config.issuer)
        putStrings("bearer_methods_supported", "header")
    }

    internal fun authorizationServerMetadata(): JsonObject = buildJsonObject {
        put("issuer", config.issuer)
        put("authorization_endpoint", config.authorizationEndpoint)
        put("token_endpoint", config.tokenEndpoint)
        putStrings("response_types_supported", "code")
        putStrings("grant_types_supported", AUTHORIZATION_CODE, REFRESH_TOKEN)
        putStrings("code_challenge_methods_supported", S256)
        putStrings("token_endpoint_auth_methods_supported", "none")
        put("client_id_metadata_document_supported", true)
        put("authorization_response_iss_parameter_supported", true)
    }

    /**
     * Checks the query of `GET /oauth/authorize`. Until the client and its redirect URI pass, an
     * error is shown and never sent to the redirect URI.
     */
    internal fun checkAuthorization(parameters: Map<String, String>): AuthorizationCheck {
        val clientId =
            parameters["client_id"] ?: return AuthorizationCheck.ShowError("client_id is missing.")
        val client =
            when (val lookup = clients.lookUp(clientId)) {
                is ClientLookup.Invalid -> return AuthorizationCheck.ShowError(lookup.reason)
                is ClientLookup.Found -> lookup.metadata
            }
        val redirectUri =
            parameters["redirect_uri"]?.takeIf { it in client.redirectUris }
                ?: return AuthorizationCheck.ShowError(
                    "The redirect_uri is not one of the client's registered redirect URIs."
                )
        val state = parameters["state"]
        fun fail(error: String, description: String) =
            AuthorizationCheck.Redirect(
                redirectWith(
                    redirectUri,
                    "error" to error,
                    "error_description" to description,
                    "state" to state,
                )
            )
        val resource = parameters["resource"] ?: config.resource
        val codeChallenge = parameters["code_challenge"]
        return when {
            parameters["response_type"] != "code" ->
                fail("unsupported_response_type", "response_type must be code.")
            codeChallenge.isNullOrEmpty() || parameters["code_challenge_method"] != S256 ->
                fail("invalid_request", "PKCE with code_challenge_method S256 is required.")
            !isOurResource(resource) ->
                fail("invalid_target", "The resource must be ${config.resource}.")
            else ->
                AuthorizationCheck.Valid(
                    AuthorizationRequest(client, redirectUri, codeChallenge, state, config.resource)
                )
        }
    }

    /** The CSRF token of the consent form, bound to [userId] and to the whole request. */
    internal fun consentToken(userId: UserId, request: AuthorizationRequest): String =
        tokens.sign(
            TokenKind.CONSENT,
            userId,
            config.authorizationEndpoint,
            config.consentLifetime,
            request.claims(),
        )

    /**
     * The answer to the consent form. [userId] comes from the session cookie, and the form's token
     * must be for that same user, so a form posted from another site or for another user does
     * nothing.
     */
    internal fun decide(
        userId: UserId,
        consentToken: String?,
        approved: Boolean,
    ): AuthorizationCheck {
        val consent =
            consentToken
                ?.let { tokens.verify(it, TokenKind.CONSENT, config.authorizationEndpoint) }
                ?.takeIf { it.userId == userId }
                ?: return AuthorizationCheck.ShowError(
                    "This approval form is not valid anymore. Start the connection again from the agent."
                )
        val redirectUri = consent.string(REDIRECT_URI)!!
        val state = consent.string(STATE)
        if (!approved) {
            return AuthorizationCheck.Redirect(
                redirectWith(redirectUri, "error" to "access_denied", "state" to state)
            )
        }
        val code =
            tokens.sign(
                TokenKind.LOGIN_CODE,
                userId,
                config.tokenEndpoint,
                config.codeLifetime,
                mapOf(
                    CLIENT_ID to consent.string(CLIENT_ID)!!,
                    REDIRECT_URI to redirectUri,
                    CODE_CHALLENGE to consent.string(CODE_CHALLENGE)!!,
                    RESOURCE to consent.string(RESOURCE)!!,
                ),
            )
        return AuthorizationCheck.Redirect(
            redirectWith(redirectUri, "code" to code, "state" to state, "iss" to config.issuer)
        )
    }

    /** `POST /oauth/token`. */
    internal fun token(parameters: Map<String, String>): TokenResult =
        when (parameters["grant_type"]) {
            AUTHORIZATION_CODE -> redeemCode(parameters)
            REFRESH_TOKEN -> refresh(parameters)
            null -> failed("invalid_request", "grant_type is missing.")
            else -> failed("unsupported_grant_type", "Use authorization_code or refresh_token.")
        }

    private fun redeemCode(parameters: Map<String, String>): TokenResult {
        val missing =
            listOf("code", "redirect_uri", "client_id", "code_verifier").firstOrNull {
                parameters[it].isNullOrEmpty()
            }
        if (missing != null) return failed("invalid_request", "$missing is missing.")
        val code =
            tokens.verify(parameters.getValue("code"), TokenKind.LOGIN_CODE, config.tokenEndpoint)
                ?: return failed("invalid_grant", "The code is not valid or has expired.")
        if (!redeemedCodes.markRedeemed(code.tokenId, code.expiresAt)) {
            redeemedCodes.connectionOf(code.tokenId)?.let { (userId, connectionId) ->
                connections.revoke(userId, connectionId)
            }
            return failed("invalid_grant", "The code was already used.")
        }
        return when {
            parameters["client_id"] != code.string(CLIENT_ID) ->
                failed("invalid_grant", "The code was issued to another client.")
            parameters["redirect_uri"] != code.string(REDIRECT_URI) ->
                failed(
                    "invalid_grant",
                    "The redirect_uri does not match the authorization request.",
                )
            !isOurResource(parameters["resource"] ?: config.resource) ->
                failed("invalid_target", "The resource must be ${config.resource}.")
            !pkceMatches(parameters.getValue("code_verifier"), code.string(CODE_CHALLENGE)!!) ->
                failed("invalid_grant", "The code_verifier does not match the code_challenge.")
            else -> {
                val clientId = parameters.getValue("client_id")
                val secret = RefreshToken.newSecret()
                val connection =
                    connections.insert(code.userId, clientId, RefreshToken.sha256(secret))
                redeemedCodes.recordConnection(code.tokenId, code.userId, connection.id)
                issue(code.userId, clientId, RefreshToken(code.userId, connection.id, secret))
            }
        }
    }

    private fun refresh(parameters: Map<String, String>): TokenResult {
        val missing =
            listOf("refresh_token", "client_id").firstOrNull { parameters[it].isNullOrEmpty() }
        if (missing != null) return failed("invalid_request", "$missing is missing.")
        val invalid = failed("invalid_grant", "The refresh token is not valid.")
        val presented = RefreshToken.parse(parameters.getValue("refresh_token")) ?: return invalid
        val connection =
            connections.find(presented.userId, presented.connectionId)?.takeIf {
                it.revokedAt == null
            } ?: return invalid
        if (connection.clientId != parameters["client_id"]) return invalid
        if (!isOurResource(parameters["resource"] ?: config.resource)) {
            return failed("invalid_target", "The resource must be ${config.resource}.")
        }
        val secret = RefreshToken.newSecret()
        val rotated =
            connections.rotateRefreshSecret(
                presented.userId,
                presented.connectionId,
                presented.secretHash,
                RefreshToken.sha256(secret),
            )
        if (!rotated) {
            connections.revoke(presented.userId, presented.connectionId)
            return failed(
                "invalid_grant",
                "The refresh token was already used, so the connection is closed. Connect the agent again.",
            )
        }
        return issue(
            presented.userId,
            connection.clientId,
            RefreshToken(presented.userId, presented.connectionId, secret),
        )
    }

    private fun issue(userId: UserId, clientId: String, refreshToken: RefreshToken): TokenResult {
        val accessToken =
            tokens.sign(
                TokenKind.ACCESS,
                userId,
                config.resource,
                config.accessTokenLifetime,
                mapOf(CLIENT_ID to clientId),
            )
        return TokenResult.Issued(
            buildJsonObject {
                put("access_token", accessToken)
                put("token_type", "Bearer")
                put("expires_in", config.accessTokenLifetime.seconds)
                put("refresh_token", refreshToken.encoded())
            }
        )
    }

    private fun isOurResource(resource: String): Boolean =
        resource.trimEnd('/').equals(config.resource, ignoreCase = true)

    private fun AuthorizationRequest.claims(): Map<String, String> =
        listOfNotNull(
                CLIENT_ID to client.clientId,
                REDIRECT_URI to redirectUri,
                CODE_CHALLENGE to codeChallenge,
                RESOURCE to resource,
                state?.let { STATE to it },
            )
            .toMap()

    private fun failed(error: String, description: String) = TokenResult.Failed(error, description)

    private companion object {
        const val AUTHORIZATION_CODE = "authorization_code"
        const val REFRESH_TOKEN = "refresh_token"
        const val S256 = "S256"
        const val CLIENT_ID = "client_id"
        const val REDIRECT_URI = "redirect_uri"
        const val CODE_CHALLENGE = "code_challenge"
        const val RESOURCE = "resource"
        const val STATE = "state"
        val codeVerifierPattern = Regex("""[A-Za-z0-9\-._~]{43,128}""")

        fun pkceMatches(verifier: String, challenge: String): Boolean {
            if (!codeVerifierPattern.matches(verifier)) return false
            val digest =
                MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII))
            val expected = Base64.getUrlEncoder().withoutPadding().encodeToString(digest)
            return MessageDigest.isEqual(expected.toByteArray(), challenge.toByteArray())
        }

        /** [base] with the non-null [parameters] added to its query. */
        fun redirectWith(base: String, vararg parameters: Pair<String, String?>): String {
            val query =
                parameters
                    .filter { it.second != null }
                    .joinToString("&") { (name, value) ->
                        "$name=" + URLEncoder.encode(value, Charsets.UTF_8)
                    }
            return base + (if ('?' in base) "&" else "?") + query
        }

        fun JsonObjectBuilder.putStrings(name: String, vararg values: String) =
            put(name, JsonArray(values.map(::JsonPrimitive)))
    }
}
