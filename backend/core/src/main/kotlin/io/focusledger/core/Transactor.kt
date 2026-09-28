package io.focusledger.core

/**
 * Runs [block] in one database transaction. Repository calls inside [block] join it. It commits
 * when [block] returns and rolls back when [block] throws. A service uses it when one request
 * writes more than one row, for example a node update with a new name and new estimates.
 */
interface Transactor {
    fun <T> inTransaction(block: () -> T): T
}
