package io.focusledger.mcp

import io.focusledger.core.UserId
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.Application
import io.ktor.server.application.createApplicationPlugin
import io.ktor.server.application.install
import io.ktor.server.engine.EmbeddedServer
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty
import io.ktor.server.netty.NettyApplicationEngine
import io.ktor.server.request.header
import io.ktor.server.request.path
import io.ktor.server.response.header
import io.ktor.server.response.respondText
import io.ktor.util.AttributeKey
import io.modelcontextprotocol.kotlin.sdk.server.Server
import io.modelcontextprotocol.kotlin.sdk.server.ServerOptions
import io.modelcontextprotocol.kotlin.sdk.server.mcpStatelessStreamableHttp
import io.modelcontextprotocol.kotlin.sdk.types.CallToolResult
import io.modelcontextprotocol.kotlin.sdk.types.Implementation
import io.modelcontextprotocol.kotlin.sdk.types.ServerCapabilities
import io.modelcontextprotocol.kotlin.sdk.types.TextContent
import io.modelcontextprotocol.kotlin.sdk.types.ToolAnnotations
import io.modelcontextprotocol.kotlin.sdk.types.ToolSchema
import kotlinx.serialization.json.JsonObject

/** Turns the Bearer token of an MCP call into the user it belongs to. */
fun interface BearerAuthenticator {
    /** The token's user, or null when the token is unknown, expired, or revoked. */
    fun authenticate(bearerToken: String): UserId?
}

const val MCP_PATH = "/mcp"

/**
 * Serves the MCP tools at [MCP_PATH] over stateless Streamable HTTP, so any instance can answer any
 * call. A call without a valid Bearer token gets 401 before the MCP layer reads it. [allowedHosts]
 * are the `Host` values that pass the SDK's DNS-rebinding check.
 */
fun Application.ledgerMcp(
    tools: LedgerTools,
    authenticator: BearerAuthenticator,
    allowedHosts: List<String>,
) {
    install(bearerAuthentication(authenticator))
    mcpStatelessStreamableHttp(path = MCP_PATH, allowedHosts = allowedHosts) {
        mcpServer(tools, call.attributes[authenticatedUser])
    }
}

/** The MCP server on its own port. Armeria forwards `/mcp` to it. */
fun startLedgerMcpServer(
    tools: LedgerTools,
    authenticator: BearerAuthenticator,
    port: Int,
    host: String = "127.0.0.1",
    allowedHosts: List<String> = listOf("localhost", "127.0.0.1", "[::1]"),
): EmbeddedServer<NettyApplicationEngine, NettyApplicationEngine.Configuration> =
    embeddedServer(Netty, port = port, host = host) {
            ledgerMcp(tools, authenticator, allowedHosts)
        }
        .start(wait = false)

private val authenticatedUser = AttributeKey<UserId>("focusledger.mcp.user")

private fun bearerAuthentication(authenticator: BearerAuthenticator) =
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
                call.response.header(HttpHeaders.WWWAuthenticate, "Bearer")
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
                ServerCapabilities(tools = ServerCapabilities.Tools(listChanged = false))
            ),
        )
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
