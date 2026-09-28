package io.focusledger.data

import io.focusledger.core.ServiceError
import io.focusledger.core.ServiceError.Resource
import io.focusledger.core.ServiceError.Rule
import io.focusledger.core.ServiceResult
import org.jooq.exception.DataAccessException
import org.postgresql.util.PSQLException

/**
 * Maps the database errors that a rule in V1 raises to [ServiceError]. A parallel request can pass
 * the service's own check, so the database decides, and this is the one place that reads its
 * errors. Any other error is a bug and is thrown on.
 */
internal object PostgresErrors {
    private const val UNIQUE_VIOLATION = "23505"
    private const val FOREIGN_KEY_VIOLATION = "23503"
    private const val CHECK_VIOLATION = "23514"

    /** The texts of the RAISE statements in V1's trigger functions. */
    private const val LOOP_MESSAGE = "cannot move under its own descendant"
    private const val MINUTES_MESSAGE = "minutes can only grow"
    private const val FILED_MESSAGE = "is already filed"

    private val byConstraint: Map<String, ServiceError> =
        mapOf(
            "cycle_one_running" to ServiceError.FailedPrecondition(Rule.SECOND_RUNNING_CYCLE),
            "node_user_id_parent_id_fkey" to ServiceError.NotFound(Resource.NODE, "parent_id"),
            "cycle_user_id_node_id_fkey" to ServiceError.NotFound(Resource.NODE, "node_id"),
            "node_check" to ServiceError.FailedPrecondition(Rule.MOVE_UNDER_OWN_DESCENDANT),
        )

    private val byTriggerMessage: Map<String, ServiceError> =
        mapOf(
            LOOP_MESSAGE to ServiceError.FailedPrecondition(Rule.MOVE_UNDER_OWN_DESCENDANT),
            MINUTES_MESSAGE to ServiceError.FailedPrecondition(Rule.MINUTES_DECREASE),
            FILED_MESSAGE to ServiceError.FailedPrecondition(Rule.CYCLE_ALREADY_FILED),
        )

    /** Runs [block], and returns a known rule error as a [ServiceResult.Failure]. */
    fun <T> mapped(block: () -> ServiceResult<T>): ServiceResult<T> =
        try {
            block()
        } catch (error: DataAccessException) {
            ServiceResult.Failure(serviceError(error) ?: throw error)
        }

    private fun serviceError(error: DataAccessException): ServiceError? {
        val serverError = (error.cause as? PSQLException)?.serverErrorMessage ?: return null
        return when (serverError.sqlState) {
            UNIQUE_VIOLATION,
            FOREIGN_KEY_VIOLATION -> byConstraint[serverError.constraint]
            CHECK_VIOLATION ->
                byConstraint[serverError.constraint]
                    ?: byTriggerMessage.entries
                        .firstOrNull { (text, _) -> serverError.message?.contains(text) == true }
                        ?.value
            else -> null
        }
    }
}
