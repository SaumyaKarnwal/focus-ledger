package io.focusledger.data

import io.focusledger.core.RequestId
import io.focusledger.core.ServiceError
import io.focusledger.core.ledger.CreateCycle
import io.focusledger.core.ledger.FocusMode
import io.focusledger.core.ledger.ListNodesQuery
import io.focusledger.core.ledger.NodeField
import io.focusledger.core.ledger.NodeTree
import io.focusledger.core.ledger.NodeUpdate
import io.focusledger.core.ledger.Period
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class ListNodesTest {
    private val services = TestServices()
    private val ledger = services.ledger
    private val userId = services.newUser()

    @Test
    fun includeClosedFalse_hidesClosedNodeAndItsSubtree() {
        val open = services.newNode(userId, "Open")
        val closed = services.newNode(userId, "Closed")
        val underClosed = services.newNode(userId, "Under closed", parent = closed)
        services.newNode(userId, "Deeper", parent = underClosed)
        close(closed)

        val names =
            ledger
                .listNodes(userId, ListNodesQuery(includeClosed = false, period = null))
                .value()
                .nodes
                .map { it.name }

        assertEquals(listOf(open.name), names)
    }

    @Test
    fun includeClosedTrue_returnsEveryNode() {
        val closed = services.newNode(userId, "Closed")
        services.newNode(userId, "Under closed", parent = closed)
        close(closed)

        val nodes =
            ledger
                .listNodes(userId, ListNodesQuery(includeClosed = true, period = null))
                .value()
                .nodes

        assertEquals(
            listOf("Closed" to true, "Under closed" to true),
            nodes.map { it.name to it.closed },
        )
    }

    @Test
    fun period_returnsOnlyCyclesThatStartedInside() {
        val node = services.newNode(userId)
        logOn(node.id, Instant.parse("2026-09-21T10:00:00Z"))
        val inside = logOn(node.id, Instant.parse("2026-09-28T10:00:00Z"))
        logOn(node.id, Instant.parse("2026-10-05T00:00:00Z"))

        val tree =
            ledger
                .listNodes(userId, ListNodesQuery(includeClosed = true, period = THIS_WEEK))
                .value()

        assertEquals(listOf(inside), tree.nodes.single().cycles)
    }

    @Test
    fun inboxCycles_areReturnedApartFromNodes() {
        val inbox = logOn(null, Instant.parse("2026-09-28T10:00:00Z"))

        val tree =
            ledger
                .listNodes(userId, ListNodesQuery(includeClosed = true, period = THIS_WEEK))
                .value()

        assertEquals(listOf(inbox), tree.inboxCycles)
    }

    @Test
    fun cyclesOfHiddenNodes_areLeftOut() {
        val closed = services.newNode(userId, "Closed")
        logOn(closed.id, Instant.parse("2026-09-28T10:00:00Z"))
        close(closed)

        val tree =
            ledger
                .listNodes(userId, ListNodesQuery(includeClosed = false, period = THIS_WEEK))
                .value()

        assertEquals(NodeTree(emptyList(), emptyList()), tree)
    }

    /**
     * The design rule for ListNodes: a cycle that started last week, still runs, and is on a node
     * that was closed while it ran, comes back with that node and all its ancestors.
     */
    @Test
    fun runningCycleFromLastWeekOnClosedNode_isAlwaysReturnedWithItsAncestors() {
        val project = services.newNode(userId, "Project")
        val task = services.newNode(userId, "Task", parent = project)
        services.clock.now = Instant.parse("2026-09-27T23:30:00Z")
        val running =
            ledger
                .createCycle(
                    userId,
                    CreateCycle.Start(
                        RequestId(UUID.randomUUID()),
                        task.id,
                        FocusMode.DEEP_FOCUS,
                        90,
                    ),
                )
                .value()
        services.clock.now = Instant.parse("2026-09-28T00:30:00Z")
        close(project)
        close(task)

        val thisWeek =
            ledger
                .listNodes(userId, ListNodesQuery(includeClosed = false, period = THIS_WEEK))
                .value()
        val allTime =
            ledger.listNodes(userId, ListNodesQuery(includeClosed = false, period = null)).value()

        listOf(thisWeek, allTime).forEach { tree ->
            assertEquals(
                listOf("Project" to true, "Task" to true),
                tree.nodes.map { it.name to it.closed },
            )
            assertEquals(listOf(running), tree.nodes.single { it.id == task.id }.cycles)
        }
    }

    @Test
    fun runningInboxCycleFromLastWeek_isAlwaysReturned() {
        services.clock.now = Instant.parse("2026-09-27T23:30:00Z")
        val running =
            ledger
                .createCycle(
                    userId,
                    CreateCycle.Start(RequestId(UUID.randomUUID()), null, FocusMode.SHALLOW, 25),
                )
                .value()

        val tree =
            ledger
                .listNodes(userId, ListNodesQuery(includeClosed = false, period = THIS_WEEK))
                .value()

        assertEquals(listOf(running), tree.inboxCycles)
    }

    @Test
    fun periodEndBeforeStart_isInvalid() {
        val result =
            ledger.listNodes(userId, ListNodesQuery(false, Period(THIS_WEEK.end, THIS_WEEK.start)))

        assertFailure(ServiceError.InvalidArgument("period", "start must be before end"), result)
    }

    private fun close(node: io.focusledger.core.ledger.Node) {
        ledger
            .updateNode(userId, node.id, NodeUpdate(setOf(NodeField.CLOSED), closed = true))
            .value()
    }

    private fun logOn(nodeId: io.focusledger.core.NodeId?, startedAt: Instant) =
        ledger
            .createCycle(
                userId,
                CreateCycle.HandEntry(
                    RequestId(UUID.randomUUID()),
                    nodeId,
                    FocusMode.EXECUTION,
                    startedAt,
                    30,
                ),
            )
            .value()

    private companion object {
        val THIS_WEEK =
            Period(Instant.parse("2026-09-28T00:00:00Z"), Instant.parse("2026-10-05T00:00:00Z"))
    }
}
