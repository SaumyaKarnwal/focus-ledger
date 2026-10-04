package io.focusledger.data

import io.focusledger.core.NodeId
import io.focusledger.core.RequestId
import io.focusledger.core.ServiceError
import io.focusledger.core.ServiceResult
import io.focusledger.core.UserId
import io.focusledger.core.ledger.Cycle
import io.focusledger.core.ledger.Estimate
import io.focusledger.core.ledger.FocusMode
import io.focusledger.core.ledger.IdempotentInsert
import io.focusledger.core.ledger.ListNodesQuery
import io.focusledger.core.ledger.Node
import io.focusledger.core.ledger.NodeField
import io.focusledger.core.ledger.NodeRepository
import io.focusledger.core.ledger.NodeTree
import io.focusledger.core.ledger.NodeUpdate
import io.focusledger.data.jooq.ledger.Tables.CYCLE
import io.focusledger.data.jooq.ledger.Tables.ESTIMATE
import io.focusledger.data.jooq.ledger.Tables.NODE
import io.focusledger.data.jooq.ledger.tables.records.NodeRecord
import java.util.UUID
import org.jooq.DSLContext
import org.jooq.impl.DSL

class JooqNodeRepository(private val database: LedgerDatabase) : NodeRepository {

    override fun insert(
        userId: UserId,
        requestId: RequestId,
        parentId: NodeId?,
        name: String,
        estimates: List<Estimate>,
    ): ServiceResult<IdempotentInsert<Node>> = PostgresErrors.mapped {
        database.transaction { dsl ->
            val created =
                dsl.insertInto(NODE)
                    .set(NODE.USER_ID, userId.value)
                    .set(NODE.REQUEST_ID, requestId.value)
                    .set(NODE.PARENT_ID, parentId?.value)
                    .set(NODE.NAME, name)
                    .onConflict(NODE.USER_ID, NODE.REQUEST_ID)
                    .doNothing()
                    .returning()
                    .fetchOne()
            if (created == null) {
                val existing =
                    dsl.selectFrom(NODE)
                        .where(NODE.USER_ID.eq(userId.value), NODE.REQUEST_ID.eq(requestId.value))
                        .fetchSingle()
                ServiceResult.Success(IdempotentInsert.Existing(withEstimates(dsl, existing)))
            } else {
                replaceEstimates(dsl, userId, created.id, estimates)
                ServiceResult.Success(IdempotentInsert.Created(withEstimates(dsl, created)))
            }
        }
    }

    override fun find(userId: UserId, nodeId: NodeId): Node? {
        val dsl = database.dsl()
        return dsl.selectFrom(NODE)
            .where(NODE.USER_ID.eq(userId.value), NODE.ID.eq(nodeId.value))
            .fetchOne()
            ?.let { withEstimates(dsl, it) }
    }

    override fun update(userId: UserId, nodeId: NodeId, update: NodeUpdate): ServiceResult<Node> =
        PostgresErrors.mapped {
            database.transaction { dsl ->
                val changesTree =
                    NodeField.CLOSED in update.mask || NodeField.PARENT_ID in update.mask
                if (changesTree) lockTree(dsl, userId)
                val changes =
                    buildMap<org.jooq.Field<*>, Any?> {
                        if (NodeField.NAME in update.mask) put(NODE.NAME, update.name)
                        if (NodeField.PARENT_ID in update.mask)
                            put(NODE.PARENT_ID, update.parentId?.value)
                        if (NodeField.CLOSED in update.mask) {
                            put(
                                NODE.CLOSED_AT,
                                if (update.closed)
                                    DSL.coalesce(NODE.CLOSED_AT, DSL.currentInstant())
                                else null,
                            )
                        }
                    }
                val node =
                    if (changes.isEmpty()) {
                        dsl.selectFrom(NODE)
                            .where(NODE.USER_ID.eq(userId.value), NODE.ID.eq(nodeId.value))
                            .forUpdate()
                            .fetchOne()
                    } else {
                        dsl.update(NODE)
                            .set(changes)
                            .where(NODE.USER_ID.eq(userId.value), NODE.ID.eq(nodeId.value))
                            .returning()
                            .fetchOne()
                    }
                if (node == null) {
                    ServiceResult.Failure(
                        ServiceError.NotFound(ServiceError.Resource.NODE, "node_id")
                    )
                } else {
                    if (changesTree) keepOpenNodesUnderOpenAncestors(dsl, userId, node)
                    if (NodeField.ESTIMATES in update.mask) {
                        replaceEstimates(dsl, userId, node.id, update.estimates)
                    }
                    ServiceResult.Success(withEstimates(dsl, node))
                }
            }
        }

    override fun list(userId: UserId, query: ListNodesQuery): NodeTree {
        val dsl = database.dsl()
        val nodes = dsl.selectFrom(NODE).where(NODE.USER_ID.eq(userId.value)).fetch()
        val estimates =
            dsl.selectFrom(ESTIMATE)
                .where(ESTIMATE.USER_ID.eq(userId.value))
                .orderBy(ESTIMATE.MODE)
                .fetch()
                .groupBy({ it.nodeId }, { it.toCore() })
        // The running cycle comes back whatever its start and the period (docs/api.md).
        val inPeriodOrRunning =
            query.period?.let { period ->
                CYCLE.STARTED_AT.ge(period.start)
                    .and(CYCLE.STARTED_AT.lt(period.end))
                    .or(CYCLE.MINUTES.isNull)
            } ?: DSL.noCondition()
        val cycles =
            dsl.selectFrom(CYCLE)
                .where(CYCLE.USER_ID.eq(userId.value), inPeriodOrRunning)
                .orderBy(CYCLE.STARTED_AT, CYCLE.ID)
                .fetch()
                .map { it.toCore() }

        val visibleIds =
            visibleNodeIds(nodes, query.includeClosed, cycles.firstOrNull { it.minutes == null })
        val cyclesByNode = cycles.groupBy { it.nodeId?.value }
        return NodeTree(
            nodes =
                nodes
                    .filter { it.id in visibleIds }
                    .sortedWith(compareBy<NodeRecord>({ it.createdAt }, { it.id }))
                    .map { it.toCore(estimates[it.id].orEmpty(), cyclesByNode[it.id].orEmpty()) },
            inboxCycles = cyclesByNode[null].orEmpty(),
        )
    }

    /**
     * With [includeClosed] false, a closed node and every node under it are hidden. The running
     * cycle's node and all its ancestors are always visible.
     */
    private fun visibleNodeIds(
        nodes: List<NodeRecord>,
        includeClosed: Boolean,
        running: Cycle?,
    ): Set<UUID> {
        val byId = nodes.associateBy { it.id }
        fun ancestry(node: NodeRecord): Sequence<NodeRecord> =
            generateSequence(node) { byId[it.parentId] }

        val open =
            if (includeClosed) byId.keys
            else
                nodes
                    .filter { node -> ancestry(node).none { it.closedAt != null } }
                    .map { it.id }
                    .toSet()
        val runningChain =
            running?.nodeId?.let { byId[it.value] }?.let(::ancestry).orEmpty().map { it.id }.toSet()
        return open + runningChain
    }

    /**
     * The same per-user lock as the move trigger in V1, so that a close, a reopen, and a move of
     * one user run one at a time. Without it, a parallel close of a parent and reopen of its child
     * can deadlock, or leave an open node under a closed one.
     */
    private fun lockTree(dsl: DSLContext, userId: UserId) {
        dsl.execute(
            "SELECT pg_advisory_xact_lock(hashtext('ledger.node_reject_cycle'), hashtext(?))",
            userId.value.toString(),
        )
    }

    /**
     * Keeps "an open node never has a closed ancestor" (docs/api.md, "Completing a task"). A closed
     * [node] closes its open subtree. An open [node] reopens its closed ancestors up to the root.
     */
    private fun keepOpenNodesUnderOpenAncestors(dsl: DSLContext, userId: UserId, node: NodeRecord) {
        if (node.closedAt != null) {
            dsl.execute(
                """
                WITH RECURSIVE subtree AS (
                  SELECT id FROM ledger.node WHERE user_id = ? AND parent_id = ?
                  UNION
                  SELECT n.id FROM ledger.node n JOIN subtree s ON n.user_id = ? AND n.parent_id = s.id
                )
                UPDATE ledger.node SET closed_at = CAST(? AS timestamptz)
                WHERE user_id = ? AND closed_at IS NULL AND id IN (SELECT id FROM subtree)
                """,
                userId.value,
                node.id,
                userId.value,
                node.closedAt.toString(),
                userId.value,
            )
        } else if (node.parentId != null) {
            dsl.execute(
                """
                WITH RECURSIVE ancestors AS (
                  SELECT id, parent_id FROM ledger.node WHERE user_id = ? AND id = ?
                  UNION
                  SELECT n.id, n.parent_id FROM ledger.node n JOIN ancestors a ON n.user_id = ? AND n.id = a.parent_id
                )
                UPDATE ledger.node SET closed_at = NULL
                WHERE user_id = ? AND closed_at IS NOT NULL AND id IN (SELECT id FROM ancestors)
                """,
                userId.value,
                node.parentId,
                userId.value,
                userId.value,
            )
        }
    }

    private fun withEstimates(dsl: DSLContext, node: NodeRecord): Node =
        node.toCore(
            estimates =
                dsl.selectFrom(ESTIMATE)
                    .where(ESTIMATE.USER_ID.eq(node.userId), ESTIMATE.NODE_ID.eq(node.id))
                    .orderBy(ESTIMATE.MODE)
                    .fetch()
                    .map { it.toCore() },
            cycles = emptyList(),
        )

    /**
     * Writes [estimates] as the node's rows. A mode that [estimates] leaves out keeps its row with
     * cycle_count 0, because the app role cannot delete.
     */
    private fun replaceEstimates(
        dsl: DSLContext,
        userId: UserId,
        nodeId: UUID,
        estimates: List<Estimate>,
    ) {
        estimates.forEach { estimate ->
            dsl.insertInto(ESTIMATE)
                .set(ESTIMATE.USER_ID, userId.value)
                .set(ESTIMATE.NODE_ID, nodeId)
                .set(ESTIMATE.MODE, estimate.mode.toDb())
                .set(ESTIMATE.CYCLE_MINUTES, estimate.cycleMinutes)
                .set(ESTIMATE.CYCLE_COUNT, estimate.cycleCount)
                .onConflict(ESTIMATE.USER_ID, ESTIMATE.NODE_ID, ESTIMATE.MODE)
                .doUpdate()
                .set(ESTIMATE.CYCLE_MINUTES, estimate.cycleMinutes)
                .set(ESTIMATE.CYCLE_COUNT, estimate.cycleCount)
                .execute()
        }
        val leftOut = FocusMode.entries - estimates.map { it.mode }.toSet()
        if (leftOut.isNotEmpty()) {
            dsl.update(ESTIMATE)
                .set(ESTIMATE.CYCLE_COUNT, 0)
                .where(
                    ESTIMATE.USER_ID.eq(userId.value),
                    ESTIMATE.NODE_ID.eq(nodeId),
                    ESTIMATE.MODE.`in`(leftOut.map { it.toDb() }),
                    ESTIMATE.CYCLE_COUNT.ne(0),
                )
                .execute()
        }
    }
}
