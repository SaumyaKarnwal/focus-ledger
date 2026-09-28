package io.focusledger.core.ledger

import io.focusledger.core.CycleId
import io.focusledger.core.NodeId
import io.focusledger.core.RequestId
import io.focusledger.core.ServiceError
import io.focusledger.core.ServiceError.Rule
import io.focusledger.core.ServiceResult
import io.focusledger.core.Transactor
import io.focusledger.core.UserId
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

/** The service rules with in-memory repositories. The database tests are in backend/data. */
class CoreLedgerServiceTest {
    private val userId = UserId(UUID.randomUUID())
    private val cycles = InMemoryCycles()
    private val nodes = RecordingNodes()
    private val now = Instant.parse("2026-09-28T09:00:00Z")
    private val service =
        CoreLedgerService(nodes, cycles, DirectTransactor, Clock.fixed(now, ZoneOffset.UTC))

    @Test
    fun start_usesTheServerClock() {
        val cycle = start(RequestId(UUID.randomUUID())).value()

        assertEquals(now, cycle.startedAt)
        assertEquals(null, cycle.minutes)
    }

    @Test
    fun start_repeatWithSameModeAndPlannedMinutes_returnsStoredCycle() {
        val requestId = RequestId(UUID.randomUUID())
        val first = start(requestId).value()

        assertEquals(first, start(requestId, nodeId = NodeId(UUID.randomUUID())).value())
    }

    @Test
    fun start_repeatWithOtherMode_isInvalid() {
        val requestId = RequestId(UUID.randomUUID())
        start(requestId)

        assertEquals(REUSED, start(requestId, mode = FocusMode.SHALLOW))
    }

    @Test
    fun handEntry_setsPlannedMinutesToMinutes() {
        val cycle =
            service
                .createCycle(
                    userId,
                    CreateCycle.HandEntry(
                        RequestId(UUID.randomUUID()),
                        null,
                        FocusMode.EXECUTION,
                        now,
                        35,
                    ),
                )
                .value()

        assertEquals(35, cycle.plannedMinutes)
    }

    @Test
    fun handEntry_repeatWithOtherStart_isInvalid() {
        val requestId = RequestId(UUID.randomUUID())
        service.createCycle(
            userId,
            CreateCycle.HandEntry(requestId, null, FocusMode.EXECUTION, now, 35),
        )

        val repeat =
            service.createCycle(
                userId,
                CreateCycle.HandEntry(requestId, null, FocusMode.EXECUTION, now.plusSeconds(1), 35),
            )

        assertEquals(REUSED, repeat)
    }

    @Test
    fun stop_onRunningCycle_isAllowed() {
        val cycle = start(RequestId(UUID.randomUUID())).value()

        assertEquals(20, setMinutes(cycle.id, 20).value().minutes)
    }

    @Test
    fun extension_onLoggedCycle_isAllowed() {
        val cycle = start(RequestId(UUID.randomUUID())).value()
        setMinutes(cycle.id, 20)

        assertEquals(30, setMinutes(cycle.id, 30).value().minutes)
    }

    @Test
    fun sameMinutes_onLoggedCycle_isAllowed() {
        val cycle = start(RequestId(UUID.randomUUID())).value()
        setMinutes(cycle.id, 20)

        assertEquals(20, setMinutes(cycle.id, 20).value().minutes)
    }

    @Test
    fun lowerMinutes_onLoggedCycle_isRejected() {
        val cycle = start(RequestId(UUID.randomUUID())).value()
        setMinutes(cycle.id, 20)

        assertEquals(
            ServiceResult.Failure(ServiceError.FailedPrecondition(Rule.MINUTES_DECREASE)),
            setMinutes(cycle.id, 19),
        )
    }

    @Test
    fun zeroMinutes_isInvalid() {
        val cycle = start(RequestId(UUID.randomUUID())).value()

        assertEquals(
            ServiceResult.Failure(
                ServiceError.InvalidArgument("minutes", "must be from 1 to 1440")
            ),
            setMinutes(cycle.id, 0),
        )
    }

    @Test
    fun filing_onInboxCycle_isAllowedAndSameNodeAgainIsAllowed() {
        val cycle = start(RequestId(UUID.randomUUID())).value()
        val node = NodeId(UUID.randomUUID())

        assertEquals(node, file(cycle.id, node).value().nodeId)
        assertEquals(node, file(cycle.id, node).value().nodeId)
    }

    @Test
    fun filing_toOtherNode_isRejected() {
        val cycle = start(RequestId(UUID.randomUUID())).value()
        file(cycle.id, NodeId(UUID.randomUUID()))

        assertEquals(
            ServiceResult.Failure(ServiceError.FailedPrecondition(Rule.CYCLE_ALREADY_FILED)),
            file(cycle.id, NodeId(UUID.randomUUID())),
        )
    }

    @Test
    fun cycleUpdate_emptyMask_isInvalid() {
        val cycle = start(RequestId(UUID.randomUUID())).value()

        assertEquals(
            EMPTY_MASK,
            service.updateCycle(userId, cycle.id, CycleUpdate(emptySet(), minutes = 5)),
        )
    }

    @Test
    fun cycleUpdate_missingCycle_isNotFound() {
        val result = setMinutes(CycleId(UUID.randomUUID()), 5)

        assertEquals(
            ServiceResult.Failure(ServiceError.NotFound(ServiceError.Resource.CYCLE, "cycle_id")),
            result,
        )
    }

    @Test
    fun nodeUpdate_emptyMask_isInvalidAndWritesNothing() {
        val result = service.updateNode(userId, NodeId(UUID.randomUUID()), NodeUpdate(emptySet()))

        assertEquals(EMPTY_MASK, result)
        assertEquals(emptyList<NodeUpdate>(), nodes.updates)
    }

    @Test
    fun nodeUpdate_moveUnderItself_isRejectedAndWritesNothing() {
        val nodeId = NodeId(UUID.randomUUID())

        val result =
            service.updateNode(
                userId,
                nodeId,
                NodeUpdate(setOf(NodeField.PARENT_ID), parentId = nodeId),
            )

        assertEquals(
            ServiceResult.Failure(ServiceError.FailedPrecondition(Rule.MOVE_UNDER_OWN_DESCENDANT)),
            result,
        )
        assertEquals(emptyList<NodeUpdate>(), nodes.updates)
    }

    @Test
    fun nodeUpdate_nameOutsideMask_isNotChecked() {
        service.updateNode(
            userId,
            NodeId(UUID.randomUUID()),
            NodeUpdate(setOf(NodeField.CLOSED), name = "", closed = true),
        )

        assertEquals(
            listOf(NodeUpdate(setOf(NodeField.CLOSED), name = "", closed = true)),
            nodes.updates,
        )
    }

    @Test
    fun nodeUpdate_name_isTrimmedBeforeTheWrite() {
        service.updateNode(
            userId,
            NodeId(UUID.randomUUID()),
            NodeUpdate(setOf(NodeField.NAME), name = "  Trimmed  "),
        )

        assertEquals("Trimmed", nodes.updates.single().name)
    }

    @Test
    fun nodeUpdate_negativeEstimateCount_isInvalid() {
        val update =
            NodeUpdate(
                setOf(NodeField.ESTIMATES),
                estimates = listOf(Estimate(FocusMode.DEEP_FOCUS, 90, -1)),
            )

        val result = service.updateNode(userId, NodeId(UUID.randomUUID()), update)

        assertEquals(
            ServiceResult.Failure(
                ServiceError.InvalidArgument("estimates.cycle_count", "must be 0 or more")
            ),
            result,
        )
    }

    private fun start(
        requestId: RequestId,
        mode: FocusMode = FocusMode.DEEP_FOCUS,
        nodeId: NodeId? = null,
    ) = service.createCycle(userId, CreateCycle.Start(requestId, nodeId, mode, 50))

    private fun setMinutes(cycleId: CycleId, minutes: Int) =
        service.updateCycle(
            userId,
            cycleId,
            CycleUpdate(setOf(CycleField.MINUTES), minutes = minutes),
        )

    private fun file(cycleId: CycleId, nodeId: NodeId) =
        service.updateCycle(
            userId,
            cycleId,
            CycleUpdate(setOf(CycleField.NODE_ID), nodeId = nodeId),
        )

    private fun <T> ServiceResult<T>.value(): T = (this as ServiceResult.Success).value

    private companion object {
        val REUSED =
            ServiceResult.Failure(
                ServiceError.InvalidArgument(
                    "request_id",
                    "was already used for a different request",
                )
            )
        val EMPTY_MASK =
            ServiceResult.Failure(
                ServiceError.InvalidArgument("update_mask", "must name at least one field")
            )
    }
}

private object DirectTransactor : Transactor {
    override fun <T> inTransaction(block: () -> ServiceResult<T>): ServiceResult<T> = block()
}

/** Keeps cycles for one user, keyed by request ID, with no database rules. */
private class InMemoryCycles : CycleRepository {
    private val byRequest = mutableMapOf<RequestId, Cycle>()

    override fun insert(
        userId: UserId,
        requestId: RequestId,
        nodeId: NodeId?,
        mode: FocusMode,
        startedAt: Instant,
        plannedMinutes: Int,
        minutes: Int?,
    ): ServiceResult<IdempotentInsert<Cycle>> {
        byRequest[requestId]?.let {
            return ServiceResult.Success(IdempotentInsert.Existing(it))
        }
        val cycle =
            Cycle(CycleId(UUID.randomUUID()), nodeId, mode, startedAt, plannedMinutes, minutes)
        byRequest[requestId] = cycle
        return ServiceResult.Success(IdempotentInsert.Created(cycle))
    }

    override fun find(userId: UserId, cycleId: CycleId): Cycle? =
        byRequest.values.firstOrNull { it.id == cycleId }

    override fun findRunning(userId: UserId): Cycle? =
        byRequest.values.firstOrNull { it.minutes == null }

    override fun update(
        userId: UserId,
        cycleId: CycleId,
        update: CycleUpdate,
    ): ServiceResult<Cycle> {
        val entry = byRequest.entries.first { it.value.id == cycleId }
        val changed =
            entry.value.copy(
                minutes =
                    if (CycleField.MINUTES in update.mask) update.minutes else entry.value.minutes,
                nodeId =
                    if (CycleField.NODE_ID in update.mask) update.nodeId else entry.value.nodeId,
            )
        entry.setValue(changed)
        return ServiceResult.Success(changed)
    }
}

/** Records the node updates that reach the repository. */
private class RecordingNodes : NodeRepository {
    val updates = mutableListOf<NodeUpdate>()

    override fun insert(
        userId: UserId,
        requestId: RequestId,
        parentId: NodeId?,
        name: String,
        estimates: List<Estimate>,
    ): ServiceResult<IdempotentInsert<Node>> = error("not used")

    override fun find(userId: UserId, nodeId: NodeId): Node? = null

    override fun update(userId: UserId, nodeId: NodeId, update: NodeUpdate): ServiceResult<Node> {
        updates += update
        return ServiceResult.Success(
            Node(nodeId, null, update.name, update.closed, emptyList(), emptyList(), Instant.EPOCH)
        )
    }

    override fun list(userId: UserId, query: ListNodesQuery): NodeTree =
        NodeTree(emptyList(), emptyList())
}
