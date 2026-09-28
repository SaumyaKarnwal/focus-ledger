package io.focusledger.core

/** The result of every core service function. Each adapter maps [Failure] in one place. */
sealed interface ServiceResult<out T> {
    data class Success<out T>(val value: T) : ServiceResult<T>

    data class Failure(val error: ServiceError) : ServiceResult<Nothing>
}

/** The error kinds from docs/api.md, "Errors". */
sealed interface ServiceError {
    /** No valid session, or a sign-in credential that fails the checks or has no verified email. */
    data object Unauthenticated : ServiceError

    /**
     * A field is missing, out of range, or not allowed, or a request ID was used for a different
     * request.
     */
    data class InvalidArgument(val field: String, val reason: String) : ServiceError

    /** The node or cycle does not exist for this user. Another user's ID gives the same error. */
    data class NotFound(val resource: Resource) : ServiceError

    /** A rule rejects the change. */
    data class FailedPrecondition(val rule: Rule) : ServiceError

    enum class Resource {
        NODE,
        CYCLE,
    }

    enum class Rule {
        SECOND_RUNNING_CYCLE,
        MINUTES_DECREASE,
        CYCLE_ALREADY_FILED,
        MOVE_UNDER_OWN_DESCENDANT,
    }
}
