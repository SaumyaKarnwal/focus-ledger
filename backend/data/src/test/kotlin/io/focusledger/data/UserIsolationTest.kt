package io.focusledger.data

import io.focusledger.core.RequestId
import io.focusledger.core.ServiceError
import io.focusledger.core.ServiceError.Resource
import io.focusledger.core.account.Settings
import io.focusledger.core.account.SettingsField
import io.focusledger.core.account.SettingsUpdate
import io.focusledger.core.ledger.CreateCycle
import io.focusledger.core.ledger.CreateNode
import io.focusledger.core.ledger.CycleField
import io.focusledger.core.ledger.CycleUpdate
import io.focusledger.core.ledger.Estimate
import io.focusledger.core.ledger.FocusMode
import io.focusledger.core.ledger.ListNodesQuery
import io.focusledger.core.ledger.NodeField
import io.focusledger.core.ledger.NodeTree
import io.focusledger.core.ledger.NodeUpdate
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

/** Rule 3: user B uses user A's IDs, gets NotFound, and A's data does not change. */
class UserIsolationTest {
    private val services = TestServices()
    private val ledger = services.ledger
    private val userA = services.newUser()
    private val userB = services.newUser()
    private val nodeA = services.newNode(userA, "A's node")
    private val requestIdOfA = RequestId(UUID.randomUUID())
    private val loggedA =
        ledger
            .createCycle(
                userA,
                CreateCycle.HandEntry(requestIdOfA, null, FocusMode.EXECUTION, START, 30),
            )
            .value()
    private val runningA =
        ledger
            .createCycle(
                userA,
                CreateCycle.Start(RequestId(UUID.randomUUID()), nodeA.id, FocusMode.DEEP_FOCUS, 90),
            )
            .value()
    private val filedA =
        ledger
            .createCycle(
                userA,
                CreateCycle.HandEntry(
                    RequestId(UUID.randomUUID()),
                    nodeA.id,
                    FocusMode.SHALLOW,
                    START,
                    10,
                ),
            )
            .value()
    private val treeBefore = treeOfA()
    private val settingsBefore = services.account.getSettings(userA).value()

    @AfterEach
    fun aIsUnchanged() {
        assertEquals(treeBefore, treeOfA())
        assertEquals(settingsBefore, services.account.getSettings(userA).value())
    }

    @Test
    fun updateNode_withNodeOfA_isNotFound() {
        val result =
            ledger.updateNode(
                userB,
                nodeA.id,
                NodeUpdate(setOf(NodeField.NAME, NodeField.CLOSED), name = "Taken", closed = true),
            )

        assertFailure(ServiceError.NotFound(Resource.NODE, "node_id"), result)
    }

    @Test
    fun updateNode_estimatesOnNodeOfA_isNotFound() {
        val result =
            ledger.updateNode(
                userB,
                nodeA.id,
                NodeUpdate(
                    setOf(NodeField.ESTIMATES),
                    estimates = listOf(Estimate(FocusMode.SHALLOW, 25, 9)),
                ),
            )

        assertFailure(ServiceError.NotFound(Resource.NODE, "node_id"), result)
    }

    @Test
    fun updateNode_moveUnderNodeOfA_isNotFoundForParent() {
        val nodeB = services.newNode(userB)

        val result =
            ledger.updateNode(
                userB,
                nodeB.id,
                NodeUpdate(setOf(NodeField.PARENT_ID), parentId = nodeA.id),
            )

        assertFailure(ServiceError.NotFound(Resource.NODE, "parent_id"), result)
    }

    @Test
    fun createNode_underNodeOfA_isNotFoundForParent() {
        val result =
            ledger.createNode(
                userB,
                CreateNode(RequestId(UUID.randomUUID()), nodeA.id, "Child", emptyList()),
            )

        assertFailure(ServiceError.NotFound(Resource.NODE, "parent_id"), result)
    }

    @Test
    fun createCycle_onNodeOfA_isNotFound() {
        val result =
            ledger.createCycle(
                userB,
                CreateCycle.Start(RequestId(UUID.randomUUID()), nodeA.id, FocusMode.SHALLOW, 25),
            )

        assertFailure(ServiceError.NotFound(Resource.NODE, "node_id"), result)
    }

    @Test
    fun updateCycle_stopCycleOfA_isNotFound() {
        val result =
            ledger.updateCycle(
                userB,
                runningA.id,
                CycleUpdate(setOf(CycleField.MINUTES), minutes = 1),
            )

        assertFailure(ServiceError.NotFound(Resource.CYCLE, "cycle_id"), result)
    }

    @Test
    fun updateCycle_fileCycleOfA_isNotFound() {
        val nodeB = services.newNode(userB)

        val result =
            ledger.updateCycle(
                userB,
                loggedA.id,
                CycleUpdate(setOf(CycleField.NODE_ID), nodeId = nodeB.id),
            )

        assertFailure(ServiceError.NotFound(Resource.CYCLE, "cycle_id"), result)
    }

    /** A rule error here would tell B that A's cycle exists. */
    @Test
    fun updateCycle_lowerMinutesOnCycleOfA_isNotFoundNotARuleError() {
        val result =
            ledger.updateCycle(
                userB,
                loggedA.id,
                CycleUpdate(setOf(CycleField.MINUTES), minutes = 1),
            )

        assertFailure(ServiceError.NotFound(Resource.CYCLE, "cycle_id"), result)
    }

    @Test
    fun updateCycle_refileFiledCycleOfA_isNotFoundNotARuleError() {
        val nodeB = services.newNode(userB)

        val result =
            ledger.updateCycle(
                userB,
                filedA.id,
                CycleUpdate(setOf(CycleField.NODE_ID), nodeId = nodeB.id),
            )

        assertFailure(ServiceError.NotFound(Resource.CYCLE, "cycle_id"), result)
    }

    @Test
    fun repositoryReads_ofBWithIdsOfA_findNothing() {
        assertNull(services.nodes.find(userB, nodeA.id))
        assertNull(services.cycles.find(userB, loggedA.id))
        assertNull(services.cycles.find(userB, runningA.id))
        assertNull(services.accounts.find(io.focusledger.core.UserId(UUID.randomUUID())))
    }

    @Test
    fun updateCycle_fileToNodeOfA_isNotFoundForNode() {
        val inboxB =
            ledger
                .createCycle(
                    userB,
                    CreateCycle.HandEntry(
                        RequestId(UUID.randomUUID()),
                        null,
                        FocusMode.SHALLOW,
                        START,
                        20,
                    ),
                )
                .value()

        val result =
            ledger.updateCycle(
                userB,
                inboxB.id,
                CycleUpdate(setOf(CycleField.NODE_ID), nodeId = nodeA.id),
            )

        assertFailure(ServiceError.NotFound(Resource.NODE, "node_id"), result)
    }

    @Test
    fun createCycle_sameRequestIdAsA_createsOwnCycle() {
        val ownCycle =
            ledger
                .createCycle(
                    userB,
                    CreateCycle.HandEntry(requestIdOfA, null, FocusMode.DEEP_FOCUS, START, 45),
                )
                .value()

        assertEquals(45, ownCycle.minutes)
    }

    @Test
    fun listNodes_ofB_showsNothingOfA() {
        assertEquals(
            NodeTree(emptyList(), emptyList()),
            ledger.listNodes(userB, ListNodesQuery(true, null)).value(),
        )
    }

    @Test
    fun getRunningCycle_ofB_isNullWhileARuns() {
        assertNull(ledger.getRunningCycle(userB).value())
    }

    @Test
    fun updateSettings_ofB_leavesAUnchanged() {
        val update =
            SettingsUpdate(
                setOf(SettingsField.DEEP_FOCUS_MINUTES),
                Settings(120, 50, 25, 5, true, false),
            )

        assertEquals(120, services.account.updateSettings(userB, update).value().deepFocusMinutes)
    }

    @Test
    fun getAccount_ofB_isB() {
        assertEquals(userB, services.account.getAccount(userB).value().id)
    }

    private fun treeOfA(): NodeTree = ledger.listNodes(userA, ListNodesQuery(true, null)).value()

    private companion object {
        val START: Instant = Instant.parse("2026-09-27T10:00:00Z")
    }
}
