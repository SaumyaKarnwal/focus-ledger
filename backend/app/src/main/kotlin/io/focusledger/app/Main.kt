package io.focusledger.app

import com.zaxxer.hikari.HikariDataSource
import io.focusledger.core.account.AccountService
import io.focusledger.core.ledger.LedgerService
import io.focusledger.data.JdbcAgentConnectionRepository
import io.focusledger.mcp.oauth.HttpClientMetadataSource
import java.time.Clock
import javax.sql.DataSource
import kotlin.system.exitProcess

fun main() {
    val config =
        try {
            AppConfig.fromEnvironment(System.getenv())
        } catch (invalid: ConfigException) {
            System.err.println("Focus Ledger cannot start: ${invalid.message}")
            exitProcess(1)
        }
    val dataSource = connectionPool(config.databaseUrl)
    val clock = Clock.systemUTC()
    val (ledger, account) = coreServices(dataSource, clock)
    val server =
        FocusLedgerApp.start(
            config,
            AppServices(
                ledger = ledger,
                account = account,
                agentConnections = JdbcAgentConnectionRepository(dataSource),
                clientMetadata = HttpClientMetadataSource(),
                // No session cookie exists until ws-a builds it, so every sign-in page asks
                // the user to sign in first.
                browserSessions = { null },
                clock = clock,
            ),
        )
    Runtime.getRuntime()
        .addShutdownHook(
            Thread {
                server.stop()
                dataSource.close()
            }
        )
    println("Focus Ledger serves port ${server.port}.")
    Thread.currentThread().join()
}

/**
 * A small pool: Neon's pooler does the heavy pooling (docs/setup.md, "Connection pool"). The pool
 * connects on first use, so the program starts while the database still wakes up.
 */
private fun connectionPool(jdbcUrl: String) =
    HikariDataSource().apply {
        this.jdbcUrl = jdbcUrl
        maximumPoolSize = 4
        minimumIdle = 0
    }

// TODO(#61): build CoreLedgerService and CoreAccountService on the jOOQ repositories once #61
// merges. The orchestrator holds this PR until then.
@Suppress("UNUSED_PARAMETER")
private fun coreServices(
    dataSource: DataSource,
    clock: Clock,
): Pair<LedgerService, AccountService> = error("The core services arrive with #61.")
