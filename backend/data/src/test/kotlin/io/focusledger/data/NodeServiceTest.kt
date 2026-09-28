package io.focusledger.data

import io.focusledger.core.RequestId
import io.focusledger.core.ServiceError
import io.focusledger.core.ServiceError.Resource
import io.focusledger.core.ServiceError.Rule
import io.focusledger.core.ledger.CreateNode
import io.focusledger.core.ledger.Estimate
import io.focusledger.core.ledger.FocusMode
import io.focusledger.core.ledger.ListNodesQuery
import io.focusledger.core.ledger.NodeField
import io.focusledger.core.ledger.NodeUpdate
import io.focusledger.data.TestDatabase.APP
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class NodeServiceTest {
    private val services = TestServices()
    private val ledger = services.ledger
    private val userId = services.newUser()

    @Test
    fun createNode_withParentAndEstimates_storesBoth() {
        val parent = services.newNode(userId, "Website")
        val estimates = listOf(Estimate(FocusMode.DEEP_FOCUS, 90, 2))

        val node =
            ledger
                .createNode(
                    userId,
                    CreateNode(RequestId(UUID.randomUUID()), parent.id, "  Design  ", estimates),
                )
                .value()

        assertEquals(parent.id, node.parentId)
        assertEquals("Design", node.name)
        assertEquals(estimates, node.estimates)
    }

    @Test
    fun createNode_repeatWithSameKey_returnsExistingNodeWithNoComparison() {
        val requestId = RequestId(UUID.randomUUID())
        val first =
            ledger.createNode(userId, CreateNode(requestId, null, "First", emptyList())).value()
        ledger
            .updateNode(userId, first.id, NodeUpdate(setOf(NodeField.NAME), name = "Renamed"))
            .value()

        val repeat =
            ledger
                .createNode(userId, CreateNode(requestId, null, "Other name", emptyList()))
                .value()

        assertEquals(first.id, repeat.id)
        assertEquals("Renamed", repeat.name)
        assertEquals(
            1,
            ledger.listNodes(userId, ALL_TIME).value().nodes.count { it.id == first.id },
        )
    }

    @Test
    fun createNode_emptyName_isInvalid() {
        val result =
            ledger.createNode(
                userId,
                CreateNode(RequestId(UUID.randomUUID()), null, "   ", emptyList()),
            )

        assertFailure(
            ServiceError.InvalidArgument("name", "must be 1 to 200 characters after trimming"),
            result,
        )
    }

    @Test
    fun createNode_nameOver200Characters_isInvalid() {
        val result =
            ledger.createNode(
                userId,
                CreateNode(RequestId(UUID.randomUUID()), null, "x".repeat(201), emptyList()),
            )

        assertEquals(
            ServiceError.InvalidArgument::class,
            (result as io.focusledger.core.ServiceResult.Failure).error::class,
        )
    }

    @Test
    fun createNode_duplicateEstimateMode_isInvalid() {
        val estimates =
            listOf(Estimate(FocusMode.SHALLOW, 25, 1), Estimate(FocusMode.SHALLOW, 25, 2))

        val result =
            ledger.createNode(
                userId,
                CreateNode(RequestId(UUID.randomUUID()), null, "Node", estimates),
            )

        assertFailure(
            ServiceError.InvalidArgument("estimates", "must name each mode at most once"),
            result,
        )
    }

    @Test
    fun createNode_missingParent_isNotFound() {
        val result =
            ledger.createNode(
                userId,
                CreateNode(
                    RequestId(UUID.randomUUID()),
                    io.focusledger.core.NodeId(UUID.randomUUID()),
                    "Node",
                    emptyList(),
                ),
            )

        assertFailure(ServiceError.NotFound(Resource.NODE, "parent_id"), result)
    }

    @Test
    fun updateNode_emptyMask_isInvalid() {
        val node = services.newNode(userId)

        val result = ledger.updateNode(userId, node.id, NodeUpdate(emptySet(), name = "Ignored"))

        assertFailure(
            ServiceError.InvalidArgument("update_mask", "must name at least one field"),
            result,
        )
    }

    @Test
    fun updateNode_rename_changesOnlyTheName() {
        val node = services.newNode(userId, "Old")

        val renamed =
            ledger
                .updateNode(
                    userId,
                    node.id,
                    NodeUpdate(setOf(NodeField.NAME), name = "New", closed = true),
                )
                .value()

        assertEquals("New", renamed.name)
        assertEquals(false, renamed.closed)
    }

    @Test
    fun updateNode_moveUnderOtherNode_isAccepted() {
        val first = services.newNode(userId)
        val second = services.newNode(userId)

        val moved =
            ledger
                .updateNode(
                    userId,
                    first.id,
                    NodeUpdate(setOf(NodeField.PARENT_ID), parentId = second.id),
                )
                .value()

        assertEquals(second.id, moved.parentId)
    }

    @Test
    fun updateNode_parentIdInMaskWithNoValue_movesToRoot() {
        val parent = services.newNode(userId)
        val child = services.newNode(userId, parent = parent)

        val moved =
            ledger
                .updateNode(
                    userId,
                    child.id,
                    NodeUpdate(setOf(NodeField.PARENT_ID), parentId = null),
                )
                .value()

        assertNull(moved.parentId)
    }

    @Test
    fun updateNode_moveUnderOwnDescendant_isRejected() {
        val root = services.newNode(userId)
        val child = services.newNode(userId, parent = root)
        val grandchild = services.newNode(userId, parent = child)

        val result =
            ledger.updateNode(
                userId,
                root.id,
                NodeUpdate(setOf(NodeField.PARENT_ID), parentId = grandchild.id),
            )

        assertFailure(ServiceError.FailedPrecondition(Rule.MOVE_UNDER_OWN_DESCENDANT), result)
    }

    @Test
    fun updateNode_moveUnderItself_isRejected() {
        val node = services.newNode(userId)

        val result =
            ledger.updateNode(
                userId,
                node.id,
                NodeUpdate(setOf(NodeField.PARENT_ID), parentId = node.id),
            )

        assertFailure(ServiceError.FailedPrecondition(Rule.MOVE_UNDER_OWN_DESCENDANT), result)
    }

    @Test
    fun updateNode_moveUnderMissingNode_isNotFoundForParent() {
        val node = services.newNode(userId)

        val result =
            ledger.updateNode(
                userId,
                node.id,
                NodeUpdate(
                    setOf(NodeField.PARENT_ID),
                    parentId = io.focusledger.core.NodeId(UUID.randomUUID()),
                ),
            )

        assertFailure(ServiceError.NotFound(Resource.NODE, "parent_id"), result)
    }

    @Test
    fun updateNode_renameAndFailedMove_rollsBackTheRename() {
        val node = services.newNode(userId, "Kept")

        val result =
            ledger.updateNode(
                userId,
                node.id,
                NodeUpdate(
                    setOf(NodeField.NAME, NodeField.PARENT_ID),
                    name = "Lost",
                    parentId = io.focusledger.core.NodeId(UUID.randomUUID()),
                ),
            )

        assertFailure(ServiceError.NotFound(Resource.NODE, "parent_id"), result)
        assertEquals("Kept", services.nodes.find(userId, node.id)?.name)
    }

    @Test
    fun updateNode_closeTwice_keepsTheFirstClosedAt() {
        val node = services.newNode(userId)
        ledger
            .updateNode(userId, node.id, NodeUpdate(setOf(NodeField.CLOSED), closed = true))
            .value()
        val firstClosedAt = closedAt(node.id.value)

        ledger
            .updateNode(userId, node.id, NodeUpdate(setOf(NodeField.CLOSED), closed = true))
            .value()

        assertNotNull(firstClosedAt)
        assertEquals(firstClosedAt, closedAt(node.id.value))
    }

    @Test
    fun updateNode_reopen_clearsClosedAt() {
        val node = services.newNode(userId)
        ledger
            .updateNode(userId, node.id, NodeUpdate(setOf(NodeField.CLOSED), closed = true))
            .value()

        val reopened =
            ledger
                .updateNode(userId, node.id, NodeUpdate(setOf(NodeField.CLOSED), closed = false))
                .value()

        assertEquals(false, reopened.closed)
        assertNull(closedAt(node.id.value))
    }

    @Test
    fun updateNode_estimates_replacesGivenModesAndZeroesTheOthers() {
        val node =
            ledger
                .createNode(
                    userId,
                    CreateNode(
                        RequestId(UUID.randomUUID()),
                        null,
                        "Estimated",
                        listOf(
                            Estimate(FocusMode.DEEP_FOCUS, 90, 2),
                            Estimate(FocusMode.SHALLOW, 25, 3),
                        ),
                    ),
                )
                .value()

        val updated =
            ledger
                .updateNode(
                    userId,
                    node.id,
                    NodeUpdate(
                        setOf(NodeField.ESTIMATES),
                        estimates = listOf(Estimate(FocusMode.DEEP_FOCUS, 60, 4)),
                    ),
                )
                .value()

        assertEquals(
            listOf(Estimate(FocusMode.DEEP_FOCUS, 60, 4), Estimate(FocusMode.SHALLOW, 25, 0)),
            updated.estimates,
        )
    }

    @Test
    fun updateNode_emptyEstimates_clearsEveryCount() {
        val node =
            ledger
                .createNode(
                    userId,
                    CreateNode(
                        RequestId(UUID.randomUUID()),
                        null,
                        "Estimated",
                        listOf(Estimate(FocusMode.EXECUTION, 50, 5)),
                    ),
                )
                .value()

        val cleared =
            ledger
                .updateNode(
                    userId,
                    node.id,
                    NodeUpdate(setOf(NodeField.ESTIMATES), estimates = emptyList()),
                )
                .value()

        assertEquals(listOf(Estimate(FocusMode.EXECUTION, 50, 0)), cleared.estimates)
    }

    @Test
    fun updateNode_estimateMinutesOutOfRange_isInvalid() {
        val node = services.newNode(userId)

        val result =
            ledger.updateNode(
                userId,
                node.id,
                NodeUpdate(
                    setOf(NodeField.ESTIMATES),
                    estimates = listOf(Estimate(FocusMode.EXECUTION, 481, 1)),
                ),
            )

        assertFailure(
            ServiceError.InvalidArgument("estimates.cycle_minutes", "must be from 1 to 480"),
            result,
        )
    }

    @Test
    fun updateNode_response_carriesNoCycles() {
        val node = services.newNode(userId)
        ledger
            .createCycle(
                userId,
                io.focusledger.core.ledger.CreateCycle.Start(
                    RequestId(UUID.randomUUID()),
                    node.id,
                    FocusMode.SHALLOW,
                    25,
                ),
            )
            .value()

        val renamed =
            ledger
                .updateNode(userId, node.id, NodeUpdate(setOf(NodeField.NAME), name = "Renamed"))
                .value()

        assertEquals(emptyList<Any>(), renamed.cycles)
    }

    private fun closedAt(nodeId: UUID): String? =
        TestDatabase.connectAs(APP).use {
            it.queryString(
                "SELECT closed_at FROM ledger.node WHERE user_id = ? AND id = ?",
                userId.value,
                nodeId,
            )
        }

    private companion object {
        val ALL_TIME = ListNodesQuery(includeClosed = true, period = null)
    }
}
