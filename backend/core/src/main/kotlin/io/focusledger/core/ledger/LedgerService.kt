package io.focusledger.core.ledger

import io.focusledger.core.CycleId
import io.focusledger.core.NodeId
import io.focusledger.core.ServiceResult
import io.focusledger.core.UserId

/** Nodes, estimates, and cycles. The gRPC handlers and the MCP tools call the same functions. */
interface LedgerService {
    /**
     * A repeat with the same request ID returns the existing node with no comparison, because a
     * node has no field that never changes. The node carries no cycles.
     */
    fun createNode(userId: UserId, request: CreateNode): ServiceResult<Node>

    /** The node carries no cycles. Read cycles with [listNodes]. */
    fun updateNode(userId: UserId, nodeId: NodeId, update: NodeUpdate): ServiceResult<Node>

    fun listNodes(userId: UserId, query: ListNodesQuery): ServiceResult<NodeTree>

    /** A repeat with the same request ID returns the existing cycle. */
    fun createCycle(userId: UserId, request: CreateCycle): ServiceResult<Cycle>

    fun updateCycle(userId: UserId, cycleId: CycleId, update: CycleUpdate): ServiceResult<Cycle>

    /** The user's running cycle, or null when none runs. */
    fun getRunningCycle(userId: UserId): ServiceResult<Cycle?>
}
