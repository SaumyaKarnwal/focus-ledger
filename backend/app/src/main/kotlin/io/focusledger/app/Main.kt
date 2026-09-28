package io.focusledger.app

import com.zaxxer.hikari.HikariDataSource
import io.focusledger.core.account.CoreAccountService
import io.focusledger.core.ledger.CoreLedgerService
import io.focusledger.data.JdbcAgentConnectionRepository
import io.focusledger.data.JooqAccountRepository
import io.focusledger.data.JooqCycleRepository
import io.focusledger.data.JooqNodeRepository
import io.focusledger.data.JooqSettingsRepository
import io.focusledger.data.JooqTransactor
import io.focusledger.data.LedgerDatabase
import io.focusledger.mcp.oauth.HttpClientMetadataSource
import java.time.Clock
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
    val database = LedgerDatabase(dataSource)
    val clock = Clock.systemUTC()
    val server =
        FocusLedgerApp.start(
            config,
            AppServices(
                ledger =
                    CoreLedgerService(
                        JooqNodeRepository(database),
                        JooqCycleRepository(database),
                        JooqTransactor(database),
                        clock,
                    ),
                account =
                    CoreAccountService(
                        // Google sign-in and the session cookie arrive with #65. Until then no
                        // credential passes, and every sign-in page asks the user to sign in.
                        verifier = { null },
                        accounts = JooqAccountRepository(database),
                        settings = JooqSettingsRepository(database),
                    ),
                agentConnections = JdbcAgentConnectionRepository(dataSource),
                clientMetadata = HttpClientMetadataSource(),
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
 * One small pool for jOOQ and the agent connections: Neon's pooler does the heavy pooling
 * (docs/setup.md, "Connection pool"). It connects on first use, so the program starts while the
 * database still wakes up.
 */
private fun connectionPool(jdbcUrl: String) =
    HikariDataSource().apply {
        this.jdbcUrl = jdbcUrl
        maximumPoolSize = 4
        minimumIdle = 0
    }
