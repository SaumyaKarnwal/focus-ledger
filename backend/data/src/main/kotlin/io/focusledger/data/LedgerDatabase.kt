package io.focusledger.data

import com.zaxxer.hikari.HikariConfig
import com.zaxxer.hikari.HikariDataSource
import io.focusledger.core.ServiceResult
import io.focusledger.core.Transactor
import javax.sql.DataSource
import org.jooq.DSLContext
import org.jooq.SQLDialect
import org.jooq.impl.DSL

/**
 * The jOOQ access to one database. Inside [transaction], [dsl] returns the transaction's context,
 * so every repository call in the block runs on the transaction's connection.
 */
class LedgerDatabase(dataSource: DataSource) {
    private val pooled: DSLContext = DSL.using(dataSource, SQLDialect.POSTGRES)
    private val current = ThreadLocal<DSLContext>()

    fun dsl(): DSLContext = current.get() ?: pooled

    /** Runs [block] in the current transaction, or in a new one when none runs. */
    fun <T> transaction(block: (DSLContext) -> T): T {
        current.get()?.let {
            return block(it)
        }
        return pooled.transactionResult { configuration ->
            val transactional = configuration.dsl()
            current.set(transactional)
            try {
                block(transactional)
            } finally {
                current.remove()
            }
        }
    }

    companion object {
        /**
         * A small pool: Neon's pooler does the heavy pooling (docs/setup.md, "Connection pool").
         */
        fun pooled(jdbcUrl: String): LedgerDatabase =
            LedgerDatabase(
                HikariDataSource(
                    HikariConfig().apply {
                        this.jdbcUrl = jdbcUrl
                        maximumPoolSize = 4
                        minimumIdle = 0
                    }
                )
            )
    }
}

/** Commits on [ServiceResult.Success]. Rolls back on [ServiceResult.Failure] or an exception. */
class JooqTransactor(private val database: LedgerDatabase) : Transactor {
    override fun <T> inTransaction(block: () -> ServiceResult<T>): ServiceResult<T> =
        try {
            database.transaction {
                when (val result = block()) {
                    is ServiceResult.Success -> result
                    is ServiceResult.Failure -> throw RollbackForFailure(result)
                }
            }
        } catch (rollback: RollbackForFailure) {
            rollback.failure
        } catch (wrapped: RuntimeException) {
            (wrapped.cause as? RollbackForFailure)?.failure ?: throw wrapped
        }

    private class RollbackForFailure(val failure: ServiceResult.Failure) :
        RuntimeException(null, null, false, false)
}
