package io.focusledger.mcp.oauth

import io.focusledger.mcp.MCP_PATH
import java.net.URI
import java.net.URLEncoder
import java.time.Duration

/**
 * The settings of the OAuth server. [publicBaseUrl] is the origin that agents and browsers see,
 * with no trailing slash (`PUBLIC_BASE_URL`). [signingKey] signs access tokens, login codes, and
 * consent forms (`MCP_TOKEN_SIGNING_KEY`).
 */
class OAuthConfig(
    publicBaseUrl: String,
    val signingKey: ByteArray,
    val accessTokenLifetime: Duration = Duration.ofHours(1),
    val codeLifetime: Duration = Duration.ofSeconds(60),
    val consentLifetime: Duration = Duration.ofMinutes(10),
) {
    val issuer: String = publicBaseUrl.trimEnd('/')

    init {
        val uri = URI(issuer)
        require(uri.scheme in setOf("https", "http") && uri.host != null && uri.rawPath.isEmpty()) {
            "PUBLIC_BASE_URL must be an origin such as https://example.com, with no path."
        }
        require(signingKey.size >= MIN_KEY_BYTES) {
            "MCP_TOKEN_SIGNING_KEY must have at least $MIN_KEY_BYTES bytes."
        }
    }

    /** The canonical URI of the MCP server, and the audience of every access token. */
    val resource: String = issuer + MCP_PATH

    val resourceMetadataUrl: String = "$issuer$PROTECTED_RESOURCE_METADATA_PATH"
    val authorizationEndpoint: String = "$issuer$AUTHORIZE_PATH"
    val tokenEndpoint: String = "$issuer$TOKEN_PATH"

    /** The web app's sign-in, which returns to [returnTo] (a path on this origin) afterwards. */
    fun signInUrl(returnTo: String): String =
        "/app/?return_to=" + URLEncoder.encode(returnTo, Charsets.UTF_8)

    companion object {
        const val MIN_KEY_BYTES = 32
        const val AUTHORIZE_PATH = "/oauth/authorize"
        const val TOKEN_PATH = "/oauth/token"
        const val PROTECTED_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource"
        const val AUTHORIZATION_SERVER_METADATA_PATH = "/.well-known/oauth-authorization-server"
    }
}
