package io.focusledger.core

/**
 * Runs [block] in one database transaction. Repository calls inside [block] join it. It commits
 * when [block] returns [ServiceResult.Success]. It rolls back when [block] returns
 * [ServiceResult.Failure] or throws, so a failed part of a request leaves no other part written.
 */
interface Transactor {
    fun <T> inTransaction(block: () -> ServiceResult<T>): ServiceResult<T>
}
