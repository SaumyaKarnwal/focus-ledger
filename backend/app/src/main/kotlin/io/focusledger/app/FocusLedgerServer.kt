package io.focusledger.app

import com.linecorp.armeria.client.WebClient
import com.linecorp.armeria.common.HttpRequest
import com.linecorp.armeria.common.HttpResponse
import com.linecorp.armeria.server.HttpService
import com.linecorp.armeria.server.HttpServiceWithRoutes
import com.linecorp.armeria.server.Server
import com.linecorp.armeria.server.ServiceRequestContext
import io.ktor.server.application.Application
import io.ktor.server.engine.EmbeddedServer
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty
import io.ktor.server.netty.NettyApplicationEngine
import java.time.Duration
import kotlinx.coroutines.runBlocking

/**
 * The two servers of the program. Ktor runs [ktorModule] on a loopback port that the system picks.
 * Armeria serves the public port and forwards the MCP and OAuth paths to Ktor.
 */
class FocusLedgerServer
private constructor(
    private val armeria: Server,
    private val ktor: EmbeddedServer<NettyApplicationEngine, NettyApplicationEngine.Configuration>,
) {
    /** The public port, which differs from the configured one only when that one is 0. */
    val port: Int
        get() = armeria.activeLocalPort()

    /** Stops Armeria first, so no new call reaches Ktor, then Ktor. */
    fun stop() {
        armeria.stop().join()
        ktor.stop(gracePeriodMillis = 1_000, timeoutMillis = 5_000)
    }

    companion object {
        /** The paths that Armeria forwards to Ktor. Every other path stays in Armeria. */
        val forwardedRoutes =
            listOf("/mcp", "prefix:/oauth/", "regex:^/\\.well-known/oauth-[^/]*(/.*)?$")

        /** [grpc] serves LedgerService for gRPC and gRPC-Web on the public port. */
        fun start(
            port: Int,
            grpc: HttpServiceWithRoutes,
            ktorModule: Application.() -> Unit,
        ): FocusLedgerServer {
            val ktor =
                embeddedServer(Netty, port = 0, host = LOOPBACK, module = ktorModule)
                    .start(wait = false)
            val ktorPort = runBlocking { ktor.engine.resolvedConnectors().first().port }
            val forward = KtorForward(ktorPort)
            val armeria =
                forwardedRoutes
                    .fold(Server.builder().http(port).service(grpc)) { builder, route ->
                        builder.service(route, forward)
                    }
                    .build()
            armeria.start().join()
            return FocusLedgerServer(armeria, ktor)
        }

        private const val LOOPBACK = "127.0.0.1"
    }
}

/**
 * Passes a request to Ktor and streams the answer back as it arrives. A Server-Sent Events stream
 * can stay open for a long time, so the forward turns off Armeria's request timeout, the client's
 * response timeout, and the response length limit.
 */
private class KtorForward(ktorPort: Int) : HttpService {
    private val client =
        WebClient.builder("h1c://127.0.0.1:$ktorPort")
            .responseTimeout(Duration.ZERO)
            .maxResponseLength(0)
            .build()

    override fun serve(ctx: ServiceRequestContext, req: HttpRequest): HttpResponse {
        ctx.clearRequestTimeout()
        return client.execute(req)
    }
}
