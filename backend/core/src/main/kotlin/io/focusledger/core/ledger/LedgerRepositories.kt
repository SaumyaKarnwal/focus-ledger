package io.focusledger.core.ledger

import io.focusledger.core.CycleId
import io.focusledger.core.NodeId
import io.focusledger.core.RequestId
import io.focusledger.core.UserId
import java.time.Instant

/** The result of an insert with `ON CONFLICT (user_id, request_id) DO NOTHING`. */
sealed interface IdempotentInsert<out T> {
    data class Created<out T>(val row: T) : IdempotentInsert<T>

    /** The key was used before. The service compares [row] with the request. */
    data class Existing<out T>(val row: T) : IdempotentInsert<T>
}

/** The node rows of one user. Every function filters by [UserId]. */
interface NodeRepository {
    /** Inserts the node and its estimate rows. */
    fun insert(
        userId: UserId,
        requestId: RequestId,
        parentId: NodeId?,
        name: String,
        estimates: List<Estimate>,
    ): IdempotentInsert<Node>

    /** The node with its estimates and no cycles, or null when this user has no such node. */
    fun find(userId: UserId, nodeId: NodeId): Node?

    /**
     * Changes the fields that [update] holds, and returns the node, or null when it does not exist.
     */
    fun update(userId: UserId, nodeId: NodeId, update: NodeUpdate): Node?

    /** The user's nodes with their estimates and their cycles in [ListNodesQuery.period]. */
    fun list(userId: UserId, query: ListNodesQuery): NodeTree
}

/** The cycle rows of one user. Every function filters by [UserId]. */
interface CycleRepository {
    fun insert(
        userId: UserId,
        requestId: RequestId,
        nodeId: NodeId?,
        mode: FocusMode,
        startedAt: Instant,
        plannedMinutes: Int,
        minutes: Int?,
    ): IdempotentInsert<Cycle>

    fun find(userId: UserId, cycleId: CycleId): Cycle?

    fun findRunning(userId: UserId): Cycle?

    /**
     * Changes the fields that [update] holds, and returns the cycle, or null when it does not
     * exist.
     */
    fun update(userId: UserId, cycleId: CycleId, update: CycleUpdate): Cycle?
}
