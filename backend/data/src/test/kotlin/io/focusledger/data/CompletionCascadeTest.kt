package io.focusledger.data

import io.focusledger.core.ServiceError
import io.focusledger.core.ServiceError.Resource
import io.focusledger.core.UserId
import io.focusledger.core.ledger.ListNodesQuery
import io.focusledger.core.ledger.Node
import io.focusledger.core.ledger.NodeField
import io.focusledger.core.ledger.NodeUpdate
import io.focusledger.data.TestDatabase.SUPERUSER
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Test

/** docs/api.md, "Completing a task": an open node never has a closed ancestor. */
class CompletionCascadeTest {
    private val services = TestServices()
    private val ledger = services.ledger
    private val userId = services.newUser()

    // Project > Design > Wireframes > Sketch, and Project > Build
    private val project = services.newNode(userId, "Project")
    private val design = services.newNode(userId, "Design", parent = project)
    private val wireframes = services.newNode(userId, "Wireframes", parent = design)
    private val sketch = services.newNode(userId, "Sketch", parent = wireframes)
    private val build = services.newNode(userId, "Build", parent = project)
    private val other = services.newNode(userId, "Other")

    @Test
    fun close_closesTheNodeAndItsWholeSubtreeOnly() {
        setClosed(design, true)

        assertEquals(
            mapOf(
                "Project" to false,
                "Design" to true,
                "Wireframes" to true,
                "Sketch" to true,
                "Build" to false,
                "Other" to false,
            ),
            closedByName(userId),
        )
        assertInvariant(userId)
    }

    @Test
    fun close_keepsTheCloseTimeOfADescendantThatWasClosedBefore() {
        setClosed(sketch, true)
        val sketchClosedAt = closedAt(sketch)
        services.clock.now = services.clock.now.plusSeconds(60)

        setClosed(design, true)

        assertEquals(sketchClosedAt, closedAt(sketch))
    }

    @Test
    fun reopen_reopensTheAncestorsUpToTheRootAndNothingBelow() {
        setClosed(project, true)

        setClosed(wireframes, false)

        assertEquals(
            mapOf(
                "Project" to false,
                "Design" to false,
                "Wireframes" to false,
                "Sketch" to true,
                "Build" to true,
                "Other" to false,
            ),
            closedByName(userId),
        )
        assertInvariant(userId)
    }

    @Test
    fun moveOfOpenNodeUnderClosedNode_reopensTheNewAncestors() {
        setClosed(project, true)
        val inbox = services.newNode(userId, "Loose")

        move(inbox, under = wireframes)

        assertEquals(
            mapOf(
                "Project" to false,
                "Design" to false,
                "Wireframes" to false,
                "Sketch" to true,
                "Build" to true,
                "Other" to false,
                "Loose" to false,
            ),
            closedByName(userId),
        )
        assertInvariant(userId)
    }

    @Test
    fun moveOfClosedNodeUnderClosedNode_reopensNothing() {
        setClosed(project, true)
        setClosed(other, true)

        move(other, under = design)

        assertEquals(setOf(true), closedByName(userId).values.toSet())
        assertInvariant(userId)
    }

    @Test
    fun closeAndMoveInOneUpdate_closesAndReopensNothing() {
        setClosed(project, true)

        ledger
            .updateNode(
                userId,
                other.id,
                NodeUpdate(
                    setOf(NodeField.PARENT_ID, NodeField.CLOSED),
                    parentId = design.id,
                    closed = true,
                ),
            )
            .value()

        assertEquals(setOf(true), closedByName(userId).values.toSet())
        assertInvariant(userId)
    }

    @Test
    fun moveToRoot_ofOpenNodeUnderOpenParent_changesNoOtherNode() {
        val before = closedByName(userId)

        ledger
            .updateNode(userId, sketch.id, NodeUpdate(setOf(NodeField.PARENT_ID), parentId = null))
            .value()

        assertEquals(before, closedByName(userId))
    }

    @Test
    fun cascade_waitsForTheUsersTreeLock() {
        TestDatabase.connectAs(SUPERUSER).use { holder ->
            holder.autoCommit = false
            holder.execute(
                "SELECT pg_advisory_xact_lock(hashtext('ledger.node_reject_cycle'), hashtext(?))",
                userId.value.toString(),
            )

            val close = CompletableFuture.supplyAsync { setClosed(design, true) }
            Thread.sleep(500)
            assertFalse(
                close.isDone,
                "The close ran while another transaction held the user's tree lock.",
            )
            holder.rollback()

            close.get(10, TimeUnit.SECONDS)
        }
        assertEquals(true, closedByName(userId).getValue("Sketch"))
    }

    @Test
    fun otherUser_closingOrReopeningANodeOfA_isNotFoundAndChangesNothing() {
        setClosed(project, true)
        val before = closedByName(userId)
        val userB = services.newUser()
        val nodeOfB = services.newNode(userB, "B's node")

        assertFailure(
            NOT_FOUND,
            ledger.updateNode(
                userB,
                wireframes.id,
                NodeUpdate(setOf(NodeField.CLOSED), closed = false),
            ),
        )
        assertFailure(
            NOT_FOUND,
            ledger.updateNode(
                userB,
                project.id,
                NodeUpdate(setOf(NodeField.CLOSED), closed = true),
            ),
        )
        assertFailure(
            ServiceError.NotFound(Resource.NODE, "parent_id"),
            ledger.updateNode(
                userB,
                nodeOfB.id,
                NodeUpdate(setOf(NodeField.PARENT_ID), parentId = design.id),
            ),
        )

        assertEquals(before, closedByName(userId))
    }

    private fun setClosed(node: Node, closed: Boolean): Node =
        ledger
            .updateNode(userId, node.id, NodeUpdate(setOf(NodeField.CLOSED), closed = closed))
            .value()

    private fun move(node: Node, under: Node): Node =
        ledger
            .updateNode(
                userId,
                node.id,
                NodeUpdate(setOf(NodeField.PARENT_ID), parentId = under.id),
            )
            .value()

    private fun nodesOf(user: UserId): List<Node> =
        ledger.listNodes(user, ListNodesQuery(includeClosed = true, period = null)).value().nodes

    private fun closedByName(user: UserId): Map<String, Boolean> =
        nodesOf(user).associate { it.name to it.closed }

    private fun closedAt(node: Node): String? =
        TestDatabase.connectAs(SUPERUSER).use {
            it.queryString("SELECT closed_at FROM ledger.node WHERE id = ?", node.id.value)
        }

    private fun assertInvariant(user: UserId) {
        val byId = nodesOf(user).associateBy { it.id }
        byId.values
            .filter { !it.closed }
            .forEach { open ->
                val closedAncestor =
                    generateSequence(open.parentId?.let(byId::get)) { it.parentId?.let(byId::get) }
                        .firstOrNull { it.closed }
                assertEquals(
                    null,
                    closedAncestor?.name,
                    "Open node ${open.name} has a closed ancestor.",
                )
            }
    }

    private companion object {
        val NOT_FOUND = ServiceError.NotFound(Resource.NODE, "node_id")
    }
}
