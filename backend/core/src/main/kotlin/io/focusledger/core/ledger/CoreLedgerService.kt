package io.focusledger.core.ledger

import io.focusledger.core.CycleId
import io.focusledger.core.Limits
import io.focusledger.core.NodeId
import io.focusledger.core.ServiceError.Resource
import io.focusledger.core.ServiceError.Rule
import io.focusledger.core.ServiceResult
import io.focusledger.core.Transactor
import io.focusledger.core.UserId
import io.focusledger.core.checkRange
import io.focusledger.core.failedPrecondition
import io.focusledger.core.firstFailure
import io.focusledger.core.flatMap
import io.focusledger.core.invalid
import io.focusledger.core.map
import io.focusledger.core.notFound
import java.time.Clock

class CoreLedgerService(
    private val nodes: NodeRepository,
    private val cycles: CycleRepository,
    private val transactor: Transactor,
    private val clock: Clock,
) : LedgerService {

    override fun createNode(userId: UserId, request: CreateNode): ServiceResult<Node> {
        firstFailure({ checkName(request.name) }, { checkEstimates(request.estimates) })?.let {
            return it
        }
        return transactor.inTransaction {
            nodes
                .insert(
                    userId,
                    request.requestId,
                    request.parentId,
                    request.name.trim(),
                    request.estimates,
                )
                .map { inserted ->
                    when (inserted) {
                        is IdempotentInsert.Created -> inserted.row
                        is IdempotentInsert.Existing -> inserted.row
                    }
                }
        }
    }

    override fun updateNode(
        userId: UserId,
        nodeId: NodeId,
        update: NodeUpdate,
    ): ServiceResult<Node> {
        firstFailure(
                {
                    if (update.mask.isEmpty())
                        invalid("update_mask", "must name at least one field")
                    else null
                },
                { if (NodeField.NAME in update.mask) checkName(update.name) else null },
                {
                    if (NodeField.ESTIMATES in update.mask) checkEstimates(update.estimates)
                    else null
                },
                {
                    if (NodeField.PARENT_ID in update.mask && update.parentId == nodeId) {
                        failedPrecondition(Rule.MOVE_UNDER_OWN_DESCENDANT)
                    } else {
                        null
                    }
                },
            )
            ?.let {
                return it
            }
        val trimmed =
            if (NodeField.NAME in update.mask) update.copy(name = update.name.trim()) else update
        return transactor.inTransaction { nodes.update(userId, nodeId, trimmed) }
    }

    override fun listNodes(userId: UserId, query: ListNodesQuery): ServiceResult<NodeTree> {
        val period = query.period
        if (period != null && !period.start.isBefore(period.end)) {
            return invalid("period", "start must be before end")
        }
        return ServiceResult.Success(nodes.list(userId, query))
    }

    override fun createCycle(userId: UserId, request: CreateCycle): ServiceResult<Cycle> {
        val startedAt: java.time.Instant
        val plannedMinutes: Int
        val minutes: Int?
        when (request) {
            is CreateCycle.Start -> {
                startedAt = clock.instant()
                plannedMinutes = request.plannedMinutes
                minutes = null
            }
            is CreateCycle.HandEntry -> {
                startedAt = request.startedAt
                plannedMinutes = request.minutes
                minutes = request.minutes
            }
        }
        checkRange("planned_minutes", plannedMinutes, Limits.CYCLE_MINUTES)?.let {
            return it
        }
        return cycles
            .insert(
                userId,
                request.requestId,
                request.nodeId,
                request.mode,
                startedAt,
                plannedMinutes,
                minutes,
            )
            .flatMap { inserted ->
                when (inserted) {
                    is IdempotentInsert.Created -> ServiceResult.Success(inserted.row)
                    is IdempotentInsert.Existing -> sameAction(request, inserted.row)
                }
            }
    }

    /**
     * A repeat compares only the fields that never change (docs/api.md, "Idempotency"): the mode
     * and the planned minutes, and for a hand entry the start.
     */
    private fun sameAction(request: CreateCycle, stored: Cycle): ServiceResult<Cycle> {
        val matches =
            stored.mode == request.mode &&
                when (request) {
                    is CreateCycle.Start -> stored.plannedMinutes == request.plannedMinutes
                    is CreateCycle.HandEntry ->
                        stored.plannedMinutes == request.minutes &&
                            stored.startedAt == request.startedAt
                }
        return if (matches) {
            ServiceResult.Success(stored)
        } else {
            invalid("request_id", REQUEST_ID_REUSED)
        }
    }

    override fun updateCycle(
        userId: UserId,
        cycleId: CycleId,
        update: CycleUpdate,
    ): ServiceResult<Cycle> {
        firstFailure(
                {
                    if (update.mask.isEmpty())
                        invalid("update_mask", "must name at least one field")
                    else null
                },
                {
                    if (CycleField.MINUTES !in update.mask) null
                    else
                        update.minutes?.let { checkRange("minutes", it, Limits.CYCLE_MINUTES) }
                            ?: invalid("minutes", "must be set when the mask names it")
                },
                {
                    if (CycleField.NODE_ID in update.mask && update.nodeId == null) {
                        invalid("node_id", "must be set when the mask names it")
                    } else {
                        null
                    }
                },
            )
            ?.let {
                return it
            }
        return transactor.inTransaction {
            val current =
                cycles.find(userId, cycleId)
                    ?: return@inTransaction notFound(Resource.CYCLE, "cycle_id")
            firstFailure(
                {
                    val loggedMinutes = current.minutes
                    val newMinutes = update.minutes
                    if (
                        CycleField.MINUTES in update.mask &&
                            loggedMinutes != null &&
                            newMinutes != null &&
                            newMinutes < loggedMinutes
                    ) {
                        failedPrecondition(Rule.MINUTES_DECREASE)
                    } else {
                        null
                    }
                },
                {
                    if (
                        CycleField.NODE_ID in update.mask &&
                            current.nodeId != null &&
                            current.nodeId != update.nodeId
                    ) {
                        failedPrecondition(Rule.CYCLE_ALREADY_FILED)
                    } else {
                        null
                    }
                },
            ) ?: cycles.update(userId, cycleId, update)
        }
    }

    override fun getRunningCycle(userId: UserId): ServiceResult<Cycle?> =
        ServiceResult.Success(cycles.findRunning(userId))

    private fun checkName(name: String): ServiceResult.Failure? {
        val trimmed = name.trim()
        return if (trimmed.isEmpty() || trimmed.length > Limits.NAME_LENGTH) {
            invalid("name", "must be 1 to ${Limits.NAME_LENGTH} characters after trimming")
        } else {
            null
        }
    }

    private fun checkEstimates(estimates: List<Estimate>): ServiceResult.Failure? {
        if (estimates.map { it.mode }.toSet().size != estimates.size) {
            return invalid("estimates", "must name each mode at most once")
        }
        return estimates.firstNotNullOfOrNull { estimate ->
            checkRange("estimates.cycle_minutes", estimate.cycleMinutes, Limits.MODE_MINUTES)
                ?: if (estimate.cycleCount < 0)
                    invalid("estimates.cycle_count", "must be 0 or more")
                else null
        }
    }

    private companion object {
        const val REQUEST_ID_REUSED = "was already used for a different request"
    }
}
