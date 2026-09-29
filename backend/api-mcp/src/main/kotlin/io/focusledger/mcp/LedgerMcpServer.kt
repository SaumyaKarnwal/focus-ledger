package io.focusledger.mcp

import io.focusledger.core.UserId
import io.focusledger.mcp.oauth.OAuthServer
import io.focusledger.mcp.oauth.ledgerOAuth
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.Application
import io.ktor.server.application.createApplicationPlugin
import io.ktor.server.application.install
import io.ktor.server.request.header
import io.ktor.server.request.path
import io.ktor.server.response.header
import io.ktor.server.response.respondText
import io.ktor.util.AttributeKey
import io.modelcontextprotocol.kotlin.sdk.server.Server
import io.modelcontextprotocol.kotlin.sdk.server.ServerOptions
import io.modelcontextprotocol.kotlin.sdk.server.mcpStatelessStreamableHttp
import io.modelcontextprotocol.kotlin.sdk.types.CallToolResult
import io.modelcontextprotocol.kotlin.sdk.types.GetPromptResult
import io.modelcontextprotocol.kotlin.sdk.types.Implementation
import io.modelcontextprotocol.kotlin.sdk.types.PromptArgument
import io.modelcontextprotocol.kotlin.sdk.types.PromptMessage
import io.modelcontextprotocol.kotlin.sdk.types.Role
import io.modelcontextprotocol.kotlin.sdk.types.ServerCapabilities
import io.modelcontextprotocol.kotlin.sdk.types.TextContent
import io.modelcontextprotocol.kotlin.sdk.types.ToolAnnotations
import io.modelcontextprotocol.kotlin.sdk.types.ToolSchema
import java.net.URI
import kotlinx.serialization.json.JsonObject

/** Turns the Bearer token of an MCP call into the user it belongs to. */
fun interface BearerAuthenticator {
    /** The token's user, or null when the token is unknown, expired, or revoked. */
    fun authenticate(bearerToken: String): UserId?
}

const val MCP_PATH = "/mcp"

/**
 * Serves the MCP tools at [MCP_PATH] over stateless Streamable HTTP, so any instance can answer any
 * call. A call without a valid Bearer token gets 401 before the MCP layer reads it, with the
 * [resourceMetadataUrl] that tells an MCP client where to sign in. [allowedHosts] are the `Host`
 * values that pass the SDK's DNS-rebinding check.
 */
fun Application.ledgerMcp(
    tools: LedgerTools,
    authenticator: BearerAuthenticator,
    allowedHosts: List<String>,
    resourceMetadataUrl: String,
) {
    install(bearerAuthentication(authenticator, resourceMetadataUrl))
    mcpStatelessStreamableHttp(path = MCP_PATH, allowedHosts = allowedHosts) {
        mcpServer(tools, call.attributes[authenticatedUser])
    }
}

/**
 * The MCP server and its OAuth endpoints, the Ktor side of the program. Armeria forwards `/mcp`,
 * the paths under `/oauth/`, and the `/.well-known/oauth-` documents here. The `Host` check accepts
 * the public host and the loopback names.
 */
fun Application.focusLedgerMcp(tools: LedgerTools, oauth: OAuthServer) {
    val allowedHosts = listOf(URI(oauth.config.issuer).host, "localhost", "127.0.0.1", "[::1]")
    ledgerMcp(tools, oauth, allowedHosts.distinct(), oauth.config.resourceMetadataUrl)
    ledgerOAuth(oauth)
}

private val authenticatedUser = AttributeKey<UserId>("focusledger.mcp.user")

private fun bearerAuthentication(authenticator: BearerAuthenticator, resourceMetadataUrl: String) =
    createApplicationPlugin("McpBearerAuthentication") {
        onCall { call ->
            if (call.request.path() != MCP_PATH) return@onCall
            val token =
                call.request
                    .header(HttpHeaders.Authorization)
                    ?.takeIf { it.startsWith(BEARER_PREFIX, ignoreCase = true) }
                    ?.substring(BEARER_PREFIX.length)
                    ?.trim()
                    ?.takeIf { it.isNotEmpty() }
            val userId = token?.let(authenticator::authenticate)
            if (userId == null) {
                val invalidToken = if (token != null) ", error=\"invalid_token\"" else ""
                call.response.header(
                    HttpHeaders.WWWAuthenticate,
                    "Bearer resource_metadata=\"$resourceMetadataUrl\"$invalidToken",
                )
                call.respondText(
                    "A valid Bearer token is required.",
                    status = HttpStatusCode.Unauthorized,
                )
                return@onCall
            }
            call.attributes.put(authenticatedUser, userId)
        }
    }

private const val BEARER_PREFIX = "Bearer "

/** One server per call, with every tool bound to the call's user. */
private fun mcpServer(tools: LedgerTools, userId: UserId): Server {
    val server =
        Server(
            Implementation(name = "focus-ledger", version = "1"),
            ServerOptions(
                ServerCapabilities(
                    tools = ServerCapabilities.Tools(listChanged = false),
                    prompts = ServerCapabilities.Prompts(listChanged = false),
                )
            ),
            serverInstructions,
        )
    promptDefinitions.forEach { prompt ->
        server.addPrompt(
            name = prompt.name,
            description = prompt.description,
            arguments =
                prompt.arguments.map { PromptArgument(it.name, it.description, it.required) },
        ) { request ->
            GetPromptResult(
                listOf(
                    PromptMessage(
                        Role.User,
                        TextContent(prompt.text(request.arguments.orEmpty())),
                    )
                ),
                description = prompt.description,
            )
        }
    }
    tools.definitions.forEach { definition ->
        server.addTool(
            name = definition.name,
            description = definition.description,
            inputSchema =
                ToolSchema(properties = definition.properties, required = definition.required),
            toolAnnotations =
                ToolAnnotations(readOnlyHint = definition.readOnly, destructiveHint = false),
        ) { request ->
            val output =
                tools.call(userId, definition.name, request.arguments ?: JsonObject(emptyMap()))
            CallToolResult(listOf(TextContent(output.text)), isError = output.isError)
        }
    }
    return server
}
