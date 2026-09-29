package io.focusledger.app

import io.focusledger.mcp.oauth.OAuthConfig
import java.nio.file.Path

/** A missing or bad setting. The message names the variable and never holds its value. */
class ConfigException(message: String) : Exception(message)

/** The settings of the program, from environment variables (docs/setup.md, "Configuration"). */
class AppConfig(
    /** The public port that Armeria serves. */
    val port: Int,
    val databaseUrl: String,
    /** Its signing key is the UTF-8 bytes of `MCP_TOKEN_SIGNING_KEY`, as `.env.example` shows. */
    val oauth: OAuthConfig,
    /** The UTF-8 bytes of `SESSION_SIGNING_KEY`, which signs the browser session cookie. */
    val sessionSigningKey: ByteArray,
    /** The OAuth client ID that a Google ID token must name as its audience. */
    val googleClientId: String,
    /** The web build that Armeria serves. `WEB_DIR` sets it; the image holds it at `/app/web`. */
    val webDir: Path = Path.of(DEFAULT_WEB_DIR),
) {
    override fun toString(): String =
        "AppConfig(port=$port, publicBaseUrl=${oauth.issuer}, databaseUrl=<hidden>, " +
            "mcpTokenSigningKey=<hidden>, sessionSigningKey=<hidden>, googleClientId=$googleClientId, " +
            "webDir=$webDir)"

    companion object {
        const val PORT = "PORT"
        const val DB_URL_APP = "DB_URL_APP"
        const val MCP_TOKEN_SIGNING_KEY = "MCP_TOKEN_SIGNING_KEY"
        const val PUBLIC_BASE_URL = "PUBLIC_BASE_URL"
        const val SESSION_SIGNING_KEY = "SESSION_SIGNING_KEY"
        const val GOOGLE_CLIENT_ID = "GOOGLE_CLIENT_ID"
        const val WEB_DIR = "WEB_DIR"
        const val DEFAULT_WEB_DIR = "/app/web"
        private const val MIN_SESSION_KEY_BYTES = 32

        fun fromEnvironment(environment: Map<String, String>): AppConfig {
            fun required(name: String): String =
                environment[name]?.takeIf { it.isNotBlank() }
                    ?: throw ConfigException("Set the environment variable $name.")
            val port =
                required(PORT).toIntOrNull()?.takeIf { it in 0..65535 }
                    ?: throw ConfigException("$PORT must be a port number from 0 to 65535.")
            val databaseUrl = required(DB_URL_APP)
            val oauth =
                try {
                    OAuthConfig(
                        required(PUBLIC_BASE_URL),
                        required(MCP_TOKEN_SIGNING_KEY).toByteArray(Charsets.UTF_8),
                    )
                } catch (invalid: IllegalArgumentException) {
                    throw ConfigException(invalid.message ?: "An OAuth setting is not valid.")
                }
            val sessionSigningKey = required(SESSION_SIGNING_KEY).toByteArray(Charsets.UTF_8)
            if (sessionSigningKey.size < MIN_SESSION_KEY_BYTES) {
                throw ConfigException(
                    "$SESSION_SIGNING_KEY must be at least $MIN_SESSION_KEY_BYTES bytes."
                )
            }
            return AppConfig(
                port,
                databaseUrl,
                oauth,
                sessionSigningKey,
                required(GOOGLE_CLIENT_ID),
                Path.of(environment[WEB_DIR]?.takeIf { it.isNotBlank() } ?: DEFAULT_WEB_DIR),
            )
        }
    }
}
