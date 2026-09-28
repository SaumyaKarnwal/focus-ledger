package io.focusledger.app

import io.focusledger.core.account.AccountService
import io.focusledger.core.account.AgentConnectionRepository
import io.focusledger.core.ledger.LedgerService
import io.focusledger.mcp.LedgerTools
import io.focusledger.mcp.focusLedgerMcp
import io.focusledger.mcp.oauth.BrowserSessions
import io.focusledger.mcp.oauth.ClientMetadataSource
import io.focusledger.mcp.oauth.OAuthServer
import io.ktor.server.application.Application
import java.time.Clock

/** What the program needs from outside the web layer. [main] builds the real ones. */
class AppServices(
    val ledger: LedgerService,
    val account: AccountService,
    val agentConnections: AgentConnectionRepository,
    val clientMetadata: ClientMetadataSource,
    val browserSessions: BrowserSessions,
    val clock: Clock,
)

/** Wires the program with plain constructor calls and starts it. */
object FocusLedgerApp {
    /** [extraKtorModule] lets a test add routes to the Ktor side. [main] adds none. */
    fun start(
        config: AppConfig,
        services: AppServices,
        extraKtorModule: Application.() -> Unit = {},
    ): FocusLedgerServer {
        val oauth =
            OAuthServer(
                config.oauth,
                services.agentConnections,
                services.clientMetadata,
                services.browserSessions,
                services.clock,
            )
        val tools = LedgerTools(services.ledger, services.account, services.clock)
        return FocusLedgerServer.start(config.port) {
            focusLedgerMcp(tools, oauth)
            extraKtorModule()
        }
    }
}
