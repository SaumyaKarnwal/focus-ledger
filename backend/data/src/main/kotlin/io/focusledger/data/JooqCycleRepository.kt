package io.focusledger.data

import io.focusledger.core.CycleId
import io.focusledger.core.NodeId
import io.focusledger.core.RequestId
import io.focusledger.core.ServiceError
import io.focusledger.core.ServiceResult
import io.focusledger.core.UserId
import io.focusledger.core.ledger.Cycle
import io.focusledger.core.ledger.CycleField
import io.focusledger.core.ledger.CycleRepository
import io.focusledger.core.ledger.CycleUpdate
import io.focusledger.core.ledger.FocusMode
import io.focusledger.core.ledger.IdempotentInsert
import io.focusledger.data.jooq.ledger.Tables.CYCLE
import java.time.Instant

class JooqCycleRepository(private val database: LedgerDatabase) : CycleRepository {

    override fun insert(
        userId: UserId,
        requestId: RequestId,
        nodeId: NodeId?,
        mode: FocusMode,
        startedAt: Instant,
        plannedMinutes: Int,
        minutes: Int?,
    ): ServiceResult<IdempotentInsert<Cycle>> = PostgresErrors.mapped {
        val dsl = database.dsl()
        val created =
            dsl.insertInto(CYCLE)
                .set(CYCLE.USER_ID, userId.value)
                .set(CYCLE.REQUEST_ID, requestId.value)
                .set(CYCLE.NODE_ID, nodeId?.value)
                .set(CYCLE.MODE, mode.toDb())
                .set(CYCLE.STARTED_AT, startedAt)
                .set(CYCLE.PLANNED_MINUTES, plannedMinutes)
                .set(CYCLE.MINUTES, minutes)
                .onConflict(CYCLE.USER_ID, CYCLE.REQUEST_ID)
                .doNothing()
                .returning()
                .fetchOne()
        val inserted =
            created?.let { IdempotentInsert.Created(it.toCore()) }
                ?: IdempotentInsert.Existing(
                    dsl.selectFrom(CYCLE)
                        .where(CYCLE.USER_ID.eq(userId.value), CYCLE.REQUEST_ID.eq(requestId.value))
                        .fetchSingle()
                        .toCore()
                )
        ServiceResult.Success(inserted)
    }

    override fun find(userId: UserId, cycleId: CycleId): Cycle? =
        database
            .dsl()
            .selectFrom(CYCLE)
            .where(CYCLE.USER_ID.eq(userId.value), CYCLE.ID.eq(cycleId.value))
            .fetchOne()
            ?.toCore()

    override fun findRunning(userId: UserId): Cycle? =
        database
            .dsl()
            .selectFrom(CYCLE)
            .where(CYCLE.USER_ID.eq(userId.value), CYCLE.MINUTES.isNull)
            .fetchOne()
            ?.toCore()

    override fun update(
        userId: UserId,
        cycleId: CycleId,
        update: CycleUpdate,
    ): ServiceResult<Cycle> = PostgresErrors.mapped {
        val changes =
            buildMap<org.jooq.Field<*>, Any?> {
                if (CycleField.MINUTES in update.mask) put(CYCLE.MINUTES, update.minutes)
                if (CycleField.NODE_ID in update.mask) put(CYCLE.NODE_ID, update.nodeId?.value)
            }
        database
            .dsl()
            .update(CYCLE)
            .set(changes)
            .where(CYCLE.USER_ID.eq(userId.value), CYCLE.ID.eq(cycleId.value))
            .returning()
            .fetchOne()
            ?.let { ServiceResult.Success(it.toCore()) }
            ?: ServiceResult.Failure(ServiceError.NotFound(ServiceError.Resource.CYCLE, "cycle_id"))
    }
}
