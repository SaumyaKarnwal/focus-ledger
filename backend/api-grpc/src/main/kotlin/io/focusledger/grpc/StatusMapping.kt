package io.focusledger.grpc

import io.focusledger.core.ServiceError
import io.focusledger.core.ServiceResult
import io.grpc.Status
import io.grpc.StatusException

/** The one place that maps a core error to a gRPC status (docs/api.md, "Errors"). */
internal fun ServiceError.toStatus(): Status =
    when (this) {
        ServiceError.Unauthenticated -> Status.UNAUTHENTICATED.withDescription("Sign in first.")
        is ServiceError.InvalidArgument -> Status.INVALID_ARGUMENT.withDescription("$field $reason")
        is ServiceError.NotFound ->
            Status.NOT_FOUND.withDescription(
                when (resource) {
                    ServiceError.Resource.NODE -> "No node for $field."
                    ServiceError.Resource.CYCLE -> "No cycle for $field."
                }
            )
        is ServiceError.FailedPrecondition ->
            Status.FAILED_PRECONDITION.withDescription(
                when (rule) {
                    ServiceError.Rule.SECOND_RUNNING_CYCLE -> "A cycle is already running."
                    ServiceError.Rule.MINUTES_DECREASE -> "The minutes of a cycle can only grow."
                    ServiceError.Rule.CYCLE_ALREADY_FILED -> "The cycle is already filed."
                    ServiceError.Rule.MOVE_UNDER_OWN_DESCENDANT ->
                        "A node cannot move under its own descendant."
                }
            )
    }

/** The value, or a [StatusException] that the gRPC runtime sends as the call's status. */
internal fun <T> ServiceResult<T>.orThrow(): T =
    when (this) {
        is ServiceResult.Success -> value
        is ServiceResult.Failure -> throw StatusException(error.toStatus())
    }
