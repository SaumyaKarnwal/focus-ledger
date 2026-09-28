package io.focusledger.core.ledger

import io.focusledger.core.NodeId
import io.focusledger.core.RequestId
import java.time.Instant

data class CreateNode(
    val requestId: RequestId,
    /** Null creates a root node. */
    val parentId: NodeId?,
    val name: String,
    val estimates: List<Estimate>,
)

/**
 * The fields of one node update. A null field is not in the update mask. An update with no field
 * returns [io.focusledger.core.ServiceError.InvalidArgument].
 */
data class NodeUpdate(
    val name: String? = null,
    val parent: ParentChange? = null,
    val closed: Boolean? = null,
    /** Replaces all of the node's estimate rows. An empty list clears the estimate. */
    val estimates: List<Estimate>? = null,
)

/** A move. `parent_id` in the mask with no value moves the node to the root. */
sealed interface ParentChange {
    data object ToRoot : ParentChange

    data class Under(val parentId: NodeId) : ParentChange
}

data class ListNodesQuery(
    val includeClosed: Boolean,
    /** Only cycles that started in this period. Null means all time. */
    val period: Period?,
)

/**
 * The two ways to create a cycle. The adapter returns INVALID_ARGUMENT for a proto request that
 * fits neither shape: a Start with `started_at`, a hand entry with no `started_at`, or a hand entry
 * whose `planned_minutes` differs from its `minutes`.
 */
sealed interface CreateCycle {
    val requestId: RequestId
    /** Null puts the cycle in the Inbox. */
    val nodeId: NodeId?
    val mode: FocusMode

    /**
     * Starts a running cycle now, by the server clock. A repeat compares the node, the mode, and
     * the planned minutes, not the start time.
     */
    data class Start(
        override val requestId: RequestId,
        override val nodeId: NodeId?,
        override val mode: FocusMode,
        val plannedMinutes: Int,
    ) : CreateCycle

    /** Writes a logged cycle. Its planned minutes equal [minutes]. */
    data class HandEntry(
        override val requestId: RequestId,
        override val nodeId: NodeId?,
        override val mode: FocusMode,
        val startedAt: Instant,
        val minutes: Int,
    ) : CreateCycle
}

/**
 * The allowed cycle changes. A null field is not in the update mask. The type has no mode, start,
 * or planned minutes, because those never change.
 */
data class CycleUpdate(
    /**
     * The new total. On a running cycle it is the Stop, and on a logged cycle it is an extension.
     * It can never go down.
     */
    val minutes: Int? = null,
    /** Files an Inbox cycle. A cycle is filed once. */
    val fileTo: NodeId? = null,
)
