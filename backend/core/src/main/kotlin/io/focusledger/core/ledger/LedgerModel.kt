package io.focusledger.core.ledger

import io.focusledger.core.CycleId
import io.focusledger.core.NodeId
import java.time.Instant

enum class FocusMode {
    DEEP_FOCUS,
    EXECUTION,
    SHALLOW,
}

/** A time range from [start] (included) to [end] (excluded), in UTC. */
data class Period(val start: Instant, val end: Instant)

data class Estimate(val mode: FocusMode, val cycleMinutes: Int, val cycleCount: Int)

data class Cycle(
    val id: CycleId,
    /** Null means the cycle is in the Inbox. */
    val nodeId: NodeId?,
    val mode: FocusMode,
    val startedAt: Instant,
    val plannedMinutes: Int,
    /** Null means the cycle is running. */
    val minutes: Int?,
)

data class Node(
    val id: NodeId,
    /** Null means a root node. */
    val parentId: NodeId?,
    val name: String,
    val closed: Boolean,
    val estimates: List<Estimate>,
    /**
     * The node's own cycles in the requested period, from [LedgerService.listNodes] only. Other
     * functions return a node with no cycles. Descendants' cycles are on their own nodes.
     */
    val cycles: List<Cycle>,
    val createdAt: Instant,
)

/** The whole tree of one user, and the Inbox cycles, which belong to no node. */
data class NodeTree(val nodes: List<Node>, val inboxCycles: List<Cycle>)
