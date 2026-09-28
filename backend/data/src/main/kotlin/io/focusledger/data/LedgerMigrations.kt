package io.focusledger.data

import org.flywaydb.core.Flyway

object LedgerMigrations {
    /**
     * The Flyway setup for [jdbcUrl], which must connect as focusledger_migrate. The role script
     * creates both schemas, and the history table goes in ledger, because the migrate role has no
     * CREATE on public.
     */
    fun flyway(jdbcUrl: String): Flyway =
        Flyway.configure()
            .dataSource(jdbcUrl, null, null)
            .schemas("ledger", "account")
            .defaultSchema("ledger")
            .createSchemas(false)
            .placeholderReplacement(false)
            .locations("classpath:db/migration")
            .load()
}

/** Applies the pending migrations to the database in DB_URL_MIGRATE. */
fun main() {
    val jdbcUrl =
        System.getenv("DB_URL_MIGRATE")
            ?: error("Set DB_URL_MIGRATE to the migrate role's JDBC URL.")
    val result = LedgerMigrations.flyway(jdbcUrl).migrate()
    println(
        "Applied ${result.migrationsExecuted} migrations. Schema version: ${result.targetSchemaVersion ?: "unchanged"}"
    )
}
