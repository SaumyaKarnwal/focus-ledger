package io.focusledger.app

import io.focusledger.mcp.oauth.OAuthConfig

/** A missing or bad setting. The message names the variable and never holds its value. */
class ConfigException(message: String) : Exception(message)

/** The settings of the program, from environment variables (docs/setup.md, "Configuration"). */
class AppConfig(
    /** The public port that Armeria serves. */
    val port: Int,
    val databaseUrl: String,
    /** Its signing key is the UTF-8 bytes of `MCP_TOKEN_SIGNING_KEY`, as `.env.example` shows. */
    val oauth: OAuthConfig,
) {
    override fun toString(): String =
        "AppConfig(port=$port, publicBaseUrl=${oauth.issuer}, databaseUrl=<hidden>, " +
            "mcpTokenSigningKey=<hidden>)"

    companion object {
        const val PORT = "PORT"
        const val DB_URL_APP = "DB_URL_APP"
        const val MCP_TOKEN_SIGNING_KEY = "MCP_TOKEN_SIGNING_KEY"
        const val PUBLIC_BASE_URL = "PUBLIC_BASE_URL"

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
            return AppConfig(port, databaseUrl, oauth)
        }
    }
}
