package io.focusledger.mcp

import io.focusledger.core.ServiceError
import io.focusledger.core.ServiceResult

/** The value, or a [ToolInputException] with a message that tells the agent what to do. */
internal fun <T> ServiceResult<T>.orFail(): T =
    when (this) {
        is ServiceResult.Success -> value
        is ServiceResult.Failure -> throw ToolInputException(error.agentMessage())
    }

internal fun ServiceError.agentMessage(): String =
    when (this) {
        ServiceError.Unauthenticated -> "Not signed in. Check the agent's access token."
        is ServiceError.InvalidArgument -> "Invalid $field: $reason."
        is ServiceError.NotFound ->
            when (resource) {
                ServiceError.Resource.NODE ->
                    "No node found for $field. Call list_nodes to see the node paths."
                ServiceError.Resource.CYCLE ->
                    "No cycle found for $field. Call list_nodes to see the Inbox cycles and their IDs."
            }
        is ServiceError.FailedPrecondition ->
            when (rule) {
                ServiceError.Rule.SECOND_RUNNING_CYCLE ->
                    "A cycle is already running. Call stop_cycle first."
                ServiceError.Rule.MINUTES_DECREASE -> "The minutes of a cycle can only grow."
                ServiceError.Rule.CYCLE_ALREADY_FILED ->
                    "The cycle is already filed to a node. A cycle is filed once."
                ServiceError.Rule.MOVE_UNDER_OWN_DESCENDANT ->
                    "A node cannot move under its own descendant."
            }
    }
