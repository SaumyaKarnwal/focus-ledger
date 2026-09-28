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

enum class NodeField {
    NAME,
    PARENT_ID,
    CLOSED,
    ESTIMATES,
}

/**
 * One node update: the fields in [mask] change to the values here, and the service ignores the
 * values of the other fields. An empty mask returns
 * [io.focusledger.core.ServiceError.InvalidArgument].
 */
data class NodeUpdate(
    val mask: Set<NodeField>,
    val name: String = "",
    /** With [NodeField.PARENT_ID] in the mask, null moves the node to the root. */
    val parentId: NodeId? = null,
    val closed: Boolean = false,
    /** Replaces all of the node's estimate rows. An empty list clears the estimate. */
    val estimates: List<Estimate> = emptyList(),
)

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
     * Starts a running cycle now, by the server clock. A repeat compares only the mode and the
     * planned minutes, because the node, the minutes, and the server's start time can differ.
     */
    data class Start(
        override val requestId: RequestId,
        override val nodeId: NodeId?,
        override val mode: FocusMode,
        val plannedMinutes: Int,
    ) : CreateCycle

    /**
     * Writes a logged cycle. Its planned minutes equal [minutes]. A repeat compares only the mode,
     * the planned minutes, and [startedAt].
     */
    data class HandEntry(
        override val requestId: RequestId,
        override val nodeId: NodeId?,
        override val mode: FocusMode,
        val startedAt: Instant,
        val minutes: Int,
    ) : CreateCycle
}

/** The cycle fields that can change. Mode, start, and planned minutes never change. */
enum class CycleField {
    MINUTES,
    NODE_ID,
}

/**
 * One cycle update: the fields in [mask] change to the values here, and the service ignores the
 * values of the other fields. An empty mask, or a field in the mask with a null value, returns
 * [io.focusledger.core.ServiceError.InvalidArgument].
 */
data class CycleUpdate(
    val mask: Set<CycleField>,
    /**
     * The new total. On a running cycle it is the Stop, and on a logged cycle it is an extension.
     * It can never go down.
     */
    val minutes: Int? = null,
    /** Files an Inbox cycle. A cycle is filed once. */
    val nodeId: NodeId? = null,
)
