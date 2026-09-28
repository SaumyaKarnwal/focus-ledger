package io.focusledger.data

import io.focusledger.core.CycleId
import io.focusledger.core.NodeId
import io.focusledger.core.RequestId
import io.focusledger.core.ServiceError
import io.focusledger.core.ServiceError.Resource
import io.focusledger.core.ServiceError.Rule
import io.focusledger.core.ledger.CreateCycle
import io.focusledger.core.ledger.Cycle
import io.focusledger.core.ledger.CycleField
import io.focusledger.core.ledger.CycleUpdate
import io.focusledger.core.ledger.FocusMode
import java.time.Duration
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class CycleServiceTest {
    private val services = TestServices()
    private val ledger = services.ledger
    private val userId = services.newUser()

    @Test
    fun start_writesRunningCycleAtServerTime() {
        val cycle = start()

        assertNull(cycle.minutes)
        assertEquals(services.clock.now, cycle.startedAt)
        assertEquals(50, cycle.plannedMinutes)
    }

    @Test
    fun start_repeatWithSameKey_returnsRunningCycle() {
        val requestId = RequestId(UUID.randomUUID())
        val first = start(requestId)
        services.clock.now = services.clock.now.plusSeconds(5)

        val repeat = start(requestId)

        assertEquals(first, repeat)
    }

    @Test
    fun start_repeatAfterStop_returnsTheStoppedCycle() {
        val requestId = RequestId(UUID.randomUUID())
        val first = start(requestId)
        stop(first.id, 50)

        val repeat = start(requestId)

        assertEquals(first.id, repeat.id)
        assertEquals(50, repeat.minutes)
    }

    @Test
    fun start_repeatWithOtherMode_isInvalid() {
        val requestId = RequestId(UUID.randomUUID())
        start(requestId)

        val result =
            ledger.createCycle(userId, CreateCycle.Start(requestId, null, FocusMode.SHALLOW, 50))

        assertFailure(
            ServiceError.InvalidArgument("request_id", "was already used for a different request"),
            result,
        )
    }

    @Test
    fun start_repeatWithOtherPlannedMinutes_isInvalid() {
        val requestId = RequestId(UUID.randomUUID())
        start(requestId)

        val result =
            ledger.createCycle(userId, CreateCycle.Start(requestId, null, FocusMode.DEEP_FOCUS, 60))

        assertFailure(
            ServiceError.InvalidArgument("request_id", "was already used for a different request"),
            result,
        )
    }

    @Test
    fun start_whileOneRuns_isRejected() {
        start()

        val result =
            ledger.createCycle(
                userId,
                CreateCycle.Start(RequestId(UUID.randomUUID()), null, FocusMode.DEEP_FOCUS, 50),
            )

        assertFailure(ServiceError.FailedPrecondition(Rule.SECOND_RUNNING_CYCLE), result)
    }

    @Test
    fun start_plannedMinutesOutOfRange_isInvalid() {
        val result =
            ledger.createCycle(
                userId,
                CreateCycle.Start(RequestId(UUID.randomUUID()), null, FocusMode.DEEP_FOCUS, 1441),
            )

        assertFailure(
            ServiceError.InvalidArgument("planned_minutes", "must be from 1 to 1440"),
            result,
        )
    }

    @Test
    fun start_onMissingNode_isNotFound() {
        val result =
            ledger.createCycle(
                userId,
                CreateCycle.Start(
                    RequestId(UUID.randomUUID()),
                    NodeId(UUID.randomUUID()),
                    FocusMode.DEEP_FOCUS,
                    50,
                ),
            )

        assertFailure(ServiceError.NotFound(Resource.NODE, "node_id"), result)
    }

    @Test
    fun handEntry_storesPlannedMinutesEqualToMinutes() {
        val cycle = handEntry(minutes = 40)

        assertEquals(40, cycle.minutes)
        assertEquals(40, cycle.plannedMinutes)
        assertEquals(HAND_ENTRY_START, cycle.startedAt)
    }

    @Test
    fun handEntry_whileOneRuns_isAccepted() {
        start()

        val cycle = handEntry()

        assertEquals(25, cycle.minutes)
    }

    @Test
    fun handEntry_repeatWithOtherStart_isInvalid() {
        val requestId = RequestId(UUID.randomUUID())
        handEntry(requestId = requestId)

        val result =
            ledger.createCycle(
                userId,
                CreateCycle.HandEntry(
                    requestId,
                    null,
                    FocusMode.EXECUTION,
                    HAND_ENTRY_START.plusSeconds(60),
                    25,
                ),
            )

        assertFailure(
            ServiceError.InvalidArgument("request_id", "was already used for a different request"),
            result,
        )
    }

    @Test
    fun handEntry_repeatAfterExtension_returnsTheExtendedCycle() {
        val requestId = RequestId(UUID.randomUUID())
        val first = handEntry(requestId = requestId)
        stop(first.id, 40)

        val repeat = handEntry(requestId = requestId)

        assertEquals(40, repeat.minutes)
    }

    @Test
    fun stop_setsMinutes() {
        val cycle = start()

        assertEquals(50, stop(cycle.id, 50).minutes)
    }

    /** Check 15: the client rounds a Stop under 1 minute up to 1, and the server stores it. */
    @Test
    fun check15_stopAfter30Seconds_withOneMinute_logsOneMinute() {
        val cycle = start()
        services.clock.now = services.clock.now.plus(Duration.ofSeconds(30))

        assertEquals(1, stop(cycle.id, 1).minutes)
    }

    @Test
    fun check15_stopWithZeroMinutes_isInvalid() {
        val cycle = start()

        val result =
            ledger.updateCycle(
                userId,
                cycle.id,
                CycleUpdate(setOf(CycleField.MINUTES), minutes = 0),
            )

        assertFailure(ServiceError.InvalidArgument("minutes", "must be from 1 to 1440"), result)
    }

    @Test
    fun extension_growsMinutesAndKeepsPlannedMinutes() {
        val cycle = start()
        stop(cycle.id, 50)

        val extended = stop(cycle.id, 65)

        assertEquals(65, extended.minutes)
        assertEquals(50, extended.plannedMinutes)
    }

    @Test
    fun minutesDecrease_isRejected() {
        val cycle = start()
        stop(cycle.id, 50)

        val result =
            ledger.updateCycle(
                userId,
                cycle.id,
                CycleUpdate(setOf(CycleField.MINUTES), minutes = 49),
            )

        assertFailure(ServiceError.FailedPrecondition(Rule.MINUTES_DECREASE), result)
    }

    @Test
    fun repeatedStopWithSameMinutes_succeedsWithNoChange() {
        val cycle = start()
        val stopped = stop(cycle.id, 50)

        val repeat = stop(cycle.id, 50)

        assertEquals(stopped, repeat)
    }

    @Test
    fun minutesInMaskWithNoValue_isInvalid() {
        val cycle = start()

        val result =
            ledger.updateCycle(
                userId,
                cycle.id,
                CycleUpdate(setOf(CycleField.MINUTES), minutes = null),
            )

        assertFailure(
            ServiceError.InvalidArgument("minutes", "must be set when the mask names it"),
            result,
        )
    }

    @Test
    fun emptyMask_isInvalid() {
        val cycle = start()

        val result = ledger.updateCycle(userId, cycle.id, CycleUpdate(emptySet(), minutes = 50))

        assertFailure(
            ServiceError.InvalidArgument("update_mask", "must name at least one field"),
            result,
        )
    }

    @Test
    fun filingInboxCycle_setsNode() {
        val node = services.newNode(userId)
        val cycle = handEntry()

        val filed = file(cycle.id, node.id)

        assertEquals(node.id, filed.nodeId)
    }

    @Test
    fun repeatedFilingToSameNode_succeedsWithNoChange() {
        val node = services.newNode(userId)
        val cycle = handEntry()
        val filed = file(cycle.id, node.id)

        assertEquals(filed, file(cycle.id, node.id))
    }

    @Test
    fun refilingToOtherNode_isRejected() {
        val first = services.newNode(userId)
        val second = services.newNode(userId)
        val cycle = handEntry()
        file(cycle.id, first.id)

        val result =
            ledger.updateCycle(
                userId,
                cycle.id,
                CycleUpdate(setOf(CycleField.NODE_ID), nodeId = second.id),
            )

        assertFailure(ServiceError.FailedPrecondition(Rule.CYCLE_ALREADY_FILED), result)
    }

    @Test
    fun filingToMissingNode_isNotFoundForNode() {
        val cycle = handEntry()

        val result =
            ledger.updateCycle(
                userId,
                cycle.id,
                CycleUpdate(setOf(CycleField.NODE_ID), nodeId = NodeId(UUID.randomUUID())),
            )

        assertFailure(ServiceError.NotFound(Resource.NODE, "node_id"), result)
    }

    @Test
    fun updateMissingCycle_isNotFoundForCycle() {
        val result =
            ledger.updateCycle(
                userId,
                CycleId(UUID.randomUUID()),
                CycleUpdate(setOf(CycleField.MINUTES), minutes = 5),
            )

        assertFailure(ServiceError.NotFound(Resource.CYCLE, "cycle_id"), result)
    }

    @Test
    fun getRunningCycle_returnsTheRunningCycleOrNull() {
        assertNull(ledger.getRunningCycle(userId).value())
        val cycle = start()

        assertEquals(cycle, ledger.getRunningCycle(userId).value())
    }

    private fun start(requestId: RequestId = RequestId(UUID.randomUUID())): Cycle =
        ledger
            .createCycle(userId, CreateCycle.Start(requestId, null, FocusMode.DEEP_FOCUS, 50))
            .value()

    private fun handEntry(
        requestId: RequestId = RequestId(UUID.randomUUID()),
        minutes: Int = 25,
    ): Cycle =
        ledger
            .createCycle(
                userId,
                CreateCycle.HandEntry(
                    requestId,
                    null,
                    FocusMode.EXECUTION,
                    HAND_ENTRY_START,
                    minutes,
                ),
            )
            .value()

    private fun stop(cycleId: CycleId, minutes: Int): Cycle =
        ledger
            .updateCycle(userId, cycleId, CycleUpdate(setOf(CycleField.MINUTES), minutes = minutes))
            .value()

    private fun file(cycleId: CycleId, nodeId: NodeId): Cycle =
        ledger
            .updateCycle(userId, cycleId, CycleUpdate(setOf(CycleField.NODE_ID), nodeId = nodeId))
            .value()

    private companion object {
        val HAND_ENTRY_START: Instant = Instant.parse("2026-09-27T15:00:00Z")
    }
}
