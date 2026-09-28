package io.focusledger.data

import io.focusledger.core.RequestId
import io.focusledger.core.ServiceError
import io.focusledger.core.ServiceError.Rule
import io.focusledger.core.ServiceResult
import io.focusledger.core.ledger.CreateCycle
import io.focusledger.core.ledger.CycleField
import io.focusledger.core.ledger.CycleUpdate
import io.focusledger.core.ledger.FocusMode
import io.focusledger.core.ledger.NodeField
import io.focusledger.core.ledger.NodeUpdate
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

/**
 * The repositories alone, with no service check in front, as when a parallel request passes the
 * service check first. The database rule decides, and the repository reports it.
 */
class RepositoryErrorsTest {
    private val services = TestServices()
    private val userId = services.newUser()

    @Test
    fun cycleInsert_secondRunning_isSecondRunningCycle() {
        insertRunning()

        assertFailure(ServiceError.FailedPrecondition(Rule.SECOND_RUNNING_CYCLE), insertRunning())
    }

    @Test
    fun cycleUpdate_minutesDecrease_isMinutesDecrease() {
        val cycle =
            services.ledger
                .createCycle(
                    userId,
                    CreateCycle.HandEntry(
                        RequestId(UUID.randomUUID()),
                        null,
                        FocusMode.SHALLOW,
                        START,
                        30,
                    ),
                )
                .value()

        val result =
            services.cycles.update(
                userId,
                cycle.id,
                CycleUpdate(setOf(CycleField.MINUTES), minutes = 10),
            )

        assertFailure(ServiceError.FailedPrecondition(Rule.MINUTES_DECREASE), result)
    }

    @Test
    fun cycleUpdate_refile_isCycleAlreadyFiled() {
        val first = services.newNode(userId)
        val second = services.newNode(userId)
        val cycle =
            services.ledger
                .createCycle(
                    userId,
                    CreateCycle.HandEntry(
                        RequestId(UUID.randomUUID()),
                        first.id,
                        FocusMode.SHALLOW,
                        START,
                        30,
                    ),
                )
                .value()

        val result =
            services.cycles.update(
                userId,
                cycle.id,
                CycleUpdate(setOf(CycleField.NODE_ID), nodeId = second.id),
            )

        assertFailure(ServiceError.FailedPrecondition(Rule.CYCLE_ALREADY_FILED), result)
    }

    @Test
    fun nodeUpdate_moveUnderItself_isMoveUnderOwnDescendant() {
        val node = services.newNode(userId)

        val result =
            services.nodes.update(
                userId,
                node.id,
                NodeUpdate(setOf(NodeField.PARENT_ID), parentId = node.id),
            )

        assertFailure(ServiceError.FailedPrecondition(Rule.MOVE_UNDER_OWN_DESCENDANT), result)
    }

    @Test
    fun transactor_failureResult_rollsBackEarlierWrites() {
        val node = services.newNode(userId, "Kept")

        val result =
            services.transactor.inTransaction {
                services.nodes.update(
                    userId,
                    node.id,
                    NodeUpdate(setOf(NodeField.NAME), name = "Lost"),
                )
                ServiceResult.Failure(ServiceError.Unauthenticated)
            }

        assertFailure(ServiceError.Unauthenticated, result)
        assertEquals("Kept", services.nodes.find(userId, node.id)?.name)
    }

    @Test
    fun transactor_exception_rollsBackAndRethrows() {
        val node = services.newNode(userId, "Kept")

        val thrown = runCatching {
            services.transactor.inTransaction<Unit> {
                services.nodes.update(
                    userId,
                    node.id,
                    NodeUpdate(setOf(NodeField.NAME), name = "Lost"),
                )
                error("boom")
            }
        }

        assertEquals("boom", thrown.exceptionOrNull()?.message)
        assertEquals("Kept", services.nodes.find(userId, node.id)?.name)
    }

    @Test
    fun cycleRepository_findRunning_ignoresLoggedCycles() {
        services.ledger
            .createCycle(
                userId,
                CreateCycle.HandEntry(
                    RequestId(UUID.randomUUID()),
                    null,
                    FocusMode.SHALLOW,
                    START,
                    30,
                ),
            )
            .value()

        assertNull(services.cycles.findRunning(userId))
    }

    private fun insertRunning() =
        services.cycles.insert(
            userId,
            RequestId(UUID.randomUUID()),
            null,
            FocusMode.DEEP_FOCUS,
            START,
            50,
            null,
        )

    private companion object {
        val START: Instant = Instant.parse("2026-09-28T08:00:00Z")
    }
}
