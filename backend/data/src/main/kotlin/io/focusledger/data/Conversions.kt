package io.focusledger.data

import io.focusledger.core.CycleId
import io.focusledger.core.NodeId
import io.focusledger.core.ledger.Cycle
import io.focusledger.core.ledger.Estimate
import io.focusledger.core.ledger.FocusMode
import io.focusledger.core.ledger.Node
import io.focusledger.data.jooq.ledger.enums.FocusMode as DbFocusMode
import io.focusledger.data.jooq.ledger.tables.records.CycleRecord
import io.focusledger.data.jooq.ledger.tables.records.EstimateRecord
import io.focusledger.data.jooq.ledger.tables.records.NodeRecord

internal fun FocusMode.toDb(): DbFocusMode =
    when (this) {
        FocusMode.DEEP_FOCUS -> DbFocusMode.deep_focus
        FocusMode.EXECUTION -> DbFocusMode.execution
        FocusMode.SHALLOW -> DbFocusMode.shallow
    }

internal fun DbFocusMode.toCore(): FocusMode =
    when (this) {
        DbFocusMode.deep_focus -> FocusMode.DEEP_FOCUS
        DbFocusMode.execution -> FocusMode.EXECUTION
        DbFocusMode.shallow -> FocusMode.SHALLOW
    }

internal fun CycleRecord.toCore(): Cycle =
    Cycle(
        id = CycleId(id),
        nodeId = nodeId?.let(::NodeId),
        mode = mode.toCore(),
        startedAt = startedAt,
        plannedMinutes = plannedMinutes,
        minutes = minutes,
    )

internal fun EstimateRecord.toCore(): Estimate = Estimate(mode.toCore(), cycleMinutes, cycleCount)

internal fun NodeRecord.toCore(estimates: List<Estimate>, cycles: List<Cycle>): Node =
    Node(
        id = NodeId(id),
        parentId = parentId?.let(::NodeId),
        name = name,
        closed = closedAt != null,
        estimates = estimates,
        cycles = cycles,
        createdAt = createdAt,
    )
