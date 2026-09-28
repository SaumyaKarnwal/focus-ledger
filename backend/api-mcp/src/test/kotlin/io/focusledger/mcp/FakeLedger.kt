package io.focusledger.mcp

import io.focusledger.core.CycleId
import io.focusledger.core.NodeId
import io.focusledger.core.RequestId
import io.focusledger.core.ServiceError
import io.focusledger.core.ServiceResult
import io.focusledger.core.UserId
import io.focusledger.core.account.Account
import io.focusledger.core.account.AccountService
import io.focusledger.core.account.Settings
import io.focusledger.core.account.SettingsUpdate
import io.focusledger.core.account.SignInCredential
import io.focusledger.core.ledger.CreateCycle
import io.focusledger.core.ledger.CreateNode
import io.focusledger.core.ledger.Cycle
import io.focusledger.core.ledger.CycleField
import io.focusledger.core.ledger.CycleUpdate
import io.focusledger.core.ledger.LedgerService
import io.focusledger.core.ledger.ListNodesQuery
import io.focusledger.core.ledger.Node
import io.focusledger.core.ledger.NodeField
import io.focusledger.core.ledger.NodeTree
import io.focusledger.core.ledger.NodeUpdate
import java.time.Clock
import java.time.Instant
import java.time.ZoneId
import java.util.UUID

/**
 * An in-memory [LedgerService] for the tool tests, until the core services exist. It keeps each
 * user's rows apart and applies the cycle rules that the tools depend on.
 */
class FakeLedger(private val clock: Clock) : LedgerService {
    private data class Owned<T>(val userId: UserId, val requestId: RequestId?, val row: T)

    private val nodes = mutableListOf<Owned<Node>>()
    private val cycles = mutableListOf<Owned<Cycle>>()

    fun nodesOf(userId: UserId): List<Node> = nodes.filter { it.userId == userId }.map { it.row }

    fun cyclesOf(userId: UserId): List<Cycle> = cycles.filter { it.userId == userId }.map { it.row }

    fun addNode(
        userId: UserId,
        name: String,
        parent: Node? = null,
        closed: Boolean = false,
    ): Node {
        val node =
            Node(
                id = NodeId(UUID.randomUUID()),
                parentId = parent?.id,
                name = name,
                closed = closed,
                estimates = emptyList(),
                cycles = emptyList(),
                createdAt = clock.instant(),
            )
        nodes += Owned(userId, null, node)
        return node
    }

    fun addCycle(userId: UserId, cycle: Cycle): Cycle {
        cycles += Owned(userId, null, cycle)
        return cycle
    }

    override fun createNode(userId: UserId, request: CreateNode): ServiceResult<Node> {
        nodes
            .firstOrNull { it.userId == userId && it.requestId == request.requestId }
            ?.let {
                return ServiceResult.Success(it.row)
            }
        if (request.name.isBlank()) return invalid("name", "must not be empty")
        if (request.parentId != null && findNode(userId, request.parentId!!) == null) {
            return notFound(ServiceError.Resource.NODE, "parent_id")
        }
        val node =
            Node(
                id = NodeId(UUID.randomUUID()),
                parentId = request.parentId,
                name = request.name.trim(),
                closed = false,
                estimates = request.estimates,
                cycles = emptyList(),
                createdAt = clock.instant(),
            )
        nodes += Owned(userId, request.requestId, node)
        return ServiceResult.Success(node)
    }

    override fun updateNode(
        userId: UserId,
        nodeId: NodeId,
        update: NodeUpdate,
    ): ServiceResult<Node> {
        if (update.mask.isEmpty()) return invalid("update_mask", "must not be empty")
        val index = nodes.indexOfFirst { it.userId == userId && it.row.id == nodeId }
        if (index < 0) return notFound(ServiceError.Resource.NODE, "node_id")
        val old = nodes[index].row
        val node =
            old.copy(
                name = if (NodeField.NAME in update.mask) update.name else old.name,
                parentId =
                    if (NodeField.PARENT_ID in update.mask) update.parentId else old.parentId,
                closed = if (NodeField.CLOSED in update.mask) update.closed else old.closed,
                estimates =
                    if (NodeField.ESTIMATES in update.mask) update.estimates else old.estimates,
            )
        nodes[index] = nodes[index].copy(row = node)
        return ServiceResult.Success(node)
    }

    override fun listNodes(userId: UserId, query: ListNodesQuery): ServiceResult<NodeTree> {
        val userCycles =
            cyclesOf(userId).filter { cycle -> query.period?.let { cycle.startedAt in it } ?: true }
        val userNodes = nodesOf(userId)
        val byId = userNodes.associateBy { it.id }
        fun hidden(node: Node): Boolean =
            node.closed || (node.parentId?.let { byId[it] }?.let(::hidden) ?: false)
        val shown = userNodes.filter { query.includeClosed || !hidden(it) }
        return ServiceResult.Success(
            NodeTree(
                nodes =
                    shown.map { node ->
                        node.copy(cycles = userCycles.filter { it.nodeId == node.id })
                    },
                inboxCycles = userCycles.filter { it.nodeId == null },
            )
        )
    }

    override fun createCycle(userId: UserId, request: CreateCycle): ServiceResult<Cycle> {
        cycles
            .firstOrNull { it.userId == userId && it.requestId == request.requestId }
            ?.let {
                return ServiceResult.Success(it.row)
            }
        if (request.nodeId != null && findNode(userId, request.nodeId!!) == null) {
            return notFound(ServiceError.Resource.NODE, "node_id")
        }
        val cycle =
            when (request) {
                is CreateCycle.Start -> {
                    if (cyclesOf(userId).any { it.minutes == null }) {
                        return ServiceResult.Failure(
                            ServiceError.FailedPrecondition(ServiceError.Rule.SECOND_RUNNING_CYCLE)
                        )
                    }
                    if (request.plannedMinutes !in 1..1440) {
                        return invalid("planned_minutes", "must be 1 to 1440")
                    }
                    Cycle(
                        CycleId(UUID.randomUUID()),
                        request.nodeId,
                        request.mode,
                        clock.instant(),
                        request.plannedMinutes,
                        null,
                    )
                }
                is CreateCycle.HandEntry -> {
                    if (request.minutes !in 1..1440) return invalid("minutes", "must be 1 to 1440")
                    Cycle(
                        CycleId(UUID.randomUUID()),
                        request.nodeId,
                        request.mode,
                        request.startedAt,
                        request.minutes,
                        request.minutes,
                    )
                }
            }
        cycles += Owned(userId, request.requestId, cycle)
        return ServiceResult.Success(cycle)
    }

    override fun updateCycle(
        userId: UserId,
        cycleId: CycleId,
        update: CycleUpdate,
    ): ServiceResult<Cycle> {
        if (update.mask.isEmpty()) return invalid("update_mask", "must not be empty")
        val index = cycles.indexOfFirst { it.userId == userId && it.row.id == cycleId }
        if (index < 0) return notFound(ServiceError.Resource.CYCLE, "cycle_id")
        var cycle = cycles[index].row
        if (CycleField.MINUTES in update.mask) {
            val minutes = update.minutes ?: return invalid("minutes", "is required")
            if (cycle.minutes != null && minutes < cycle.minutes!!) {
                return ServiceResult.Failure(
                    ServiceError.FailedPrecondition(ServiceError.Rule.MINUTES_DECREASE)
                )
            }
            cycle = cycle.copy(minutes = minutes)
        }
        if (CycleField.NODE_ID in update.mask) {
            val nodeId = update.nodeId ?: return invalid("node_id", "is required")
            if (findNode(userId, nodeId) == null)
                return notFound(ServiceError.Resource.NODE, "node_id")
            if (cycle.nodeId != null) {
                return ServiceResult.Failure(
                    ServiceError.FailedPrecondition(ServiceError.Rule.CYCLE_ALREADY_FILED)
                )
            }
            cycle = cycle.copy(nodeId = nodeId)
        }
        cycles[index] = cycles[index].copy(row = cycle)
        return ServiceResult.Success(cycle)
    }

    override fun getRunningCycle(userId: UserId): ServiceResult<Cycle?> =
        ServiceResult.Success(cyclesOf(userId).firstOrNull { it.minutes == null })

    private fun findNode(userId: UserId, nodeId: NodeId): Node? =
        nodesOf(userId).firstOrNull { it.id == nodeId }

    private fun invalid(field: String, reason: String) =
        ServiceResult.Failure(ServiceError.InvalidArgument(field, reason))

    private fun notFound(resource: ServiceError.Resource, field: String) =
        ServiceResult.Failure(ServiceError.NotFound(resource, field))
}

/** Every user has the default settings. */
class FakeAccounts : AccountService {
    override fun signIn(credential: SignInCredential): ServiceResult<Account> =
        ServiceResult.Failure(ServiceError.Unauthenticated)

    override fun getAccount(userId: UserId): ServiceResult<Account> =
        ServiceResult.Success(Account(userId, "user@example.com", Instant.EPOCH))

    override fun getSettings(userId: UserId): ServiceResult<Settings> =
        ServiceResult.Success(
            Settings(90, 50, 25, 10, soundEnabled = true, notificationsEnabled = true)
        )

    override fun updateSettings(userId: UserId, update: SettingsUpdate): ServiceResult<Settings> =
        getSettings(userId)
}

/** A clock that a test moves by hand. */
class TestClock(var now: Instant) : Clock() {
    override fun instant(): Instant = now

    override fun getZone(): ZoneId = ZoneId.of("UTC")

    override fun withZone(zone: ZoneId): Clock = this
}
