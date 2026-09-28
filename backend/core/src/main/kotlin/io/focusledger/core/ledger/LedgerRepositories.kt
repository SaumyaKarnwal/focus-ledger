package io.focusledger.core.ledger

import io.focusledger.core.CycleId
import io.focusledger.core.NodeId
import io.focusledger.core.RequestId
import io.focusledger.core.ServiceResult
import io.focusledger.core.UserId
import java.time.Instant

/** The result of an insert with `ON CONFLICT (user_id, request_id) DO NOTHING`. */
sealed interface IdempotentInsert<out T> {
    data class Created<out T>(val row: T) : IdempotentInsert<T>

    /** The key was used before. The service compares [row] with the request. */
    data class Existing<out T>(val row: T) : IdempotentInsert<T>
}

/**
 * The node rows of one user. Every function filters by [UserId]. A write returns the database rule
 * that rejects it as a [ServiceResult.Failure], because a parallel request can pass the service's
 * own check.
 */
interface NodeRepository {
    /**
     * Inserts the node and its estimate rows. A parent that this user does not have gives
     * `NotFound(NODE, "parent_id")`.
     */
    fun insert(
        userId: UserId,
        requestId: RequestId,
        parentId: NodeId?,
        name: String,
        estimates: List<Estimate>,
    ): ServiceResult<IdempotentInsert<Node>>

    /** The node with its estimates and no cycles, or null when this user has no such node. */
    fun find(userId: UserId, nodeId: NodeId): Node?

    /**
     * Changes the fields that [update] holds. A missing node gives `NotFound(NODE, "node_id")`, and
     * a missing new parent gives `NotFound(NODE, "parent_id")`. The loop trigger's error gives
     * `FailedPrecondition(MOVE_UNDER_OWN_DESCENDANT)`.
     */
    fun update(userId: UserId, nodeId: NodeId, update: NodeUpdate): ServiceResult<Node>

    /** The user's nodes with their estimates and their cycles in [ListNodesQuery.period]. */
    fun list(userId: UserId, query: ListNodesQuery): NodeTree
}

/**
 * The cycle rows of one user. Every function filters by [UserId]. A write returns the database rule
 * that rejects it as a [ServiceResult.Failure], because a parallel request can pass the service's
 * own check.
 */
interface CycleRepository {
    /**
     * A second running cycle (the `cycle_one_running` index) gives
     * `FailedPrecondition(SECOND_RUNNING_CYCLE)`. A node that this user does not have gives
     * `NotFound(NODE, "node_id")`.
     */
    fun insert(
        userId: UserId,
        requestId: RequestId,
        nodeId: NodeId?,
        mode: FocusMode,
        startedAt: Instant,
        plannedMinutes: Int,
        minutes: Int?,
    ): ServiceResult<IdempotentInsert<Cycle>>

    fun find(userId: UserId, cycleId: CycleId): Cycle?

    fun findRunning(userId: UserId): Cycle?

    /**
     * Changes the fields that [update] holds. A missing cycle gives `NotFound(CYCLE, "cycle_id")`,
     * and a missing node to file to gives `NotFound(NODE, "node_id")`. The guard trigger's errors
     * give `FailedPrecondition` with `MINUTES_DECREASE` or `CYCLE_ALREADY_FILED`.
     */
    fun update(userId: UserId, cycleId: CycleId, update: CycleUpdate): ServiceResult<Cycle>
}
