package io.focusledger.grpc

import focusledger.v1.LedgerServiceOuterClass.CreateNodeRequest
import focusledger.v1.LedgerServiceOuterClass.GetAccountRequest
import focusledger.v1.LedgerServiceOuterClass.GetSettingsRequest
import focusledger.v1.LedgerServiceOuterClass.ListNodesRequest
import focusledger.v1.LedgerServiceOuterClass.UpdateCycleRequest
import focusledger.v1.LedgerServiceOuterClass.UpdateNodeRequest
import focusledger.v1.LedgerServiceOuterClass.UpdateSettingsRequest
import focusledger.v1.Model
import io.focusledger.grpc.RpcTest.Companion.createNode
import io.focusledger.grpc.RpcTest.Companion.handEntry
import io.focusledger.grpc.RpcTest.Companion.mask
import io.focusledger.grpc.RpcTest.Companion.settings
import io.focusledger.grpc.RpcTest.Companion.stop
import io.grpc.Status
import io.grpc.StatusRuntimeException
import java.util.UUID
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

/** Rule 3 through the gRPC API: B sends A's IDs, gets NOT_FOUND, and A's data does not change. */
class GrpcUserIsolationTest {
    private val server = GrpcTestServer()
    private val userA = server.signedIn()
    private val userB = server.signedIn()
    private val nodeA = createNode(userA, "A's node")
    private val filedA = userA.stub.createCycle(handEntry(nodeA.id, 30)).cycle
    private val runningA =
        userA.stub.createCycle(RpcTest.start().toBuilder().setNodeId(nodeA.id).build()).cycle
    private val treeBefore = treeOf(userA)
    private val settingsBefore =
        userA.stub.getSettings(GetSettingsRequest.getDefaultInstance()).settings
    private val accountBefore =
        userA.stub.getAccount(GetAccountRequest.getDefaultInstance()).account

    @AfterEach
    fun aIsUnchanged() {
        assertEquals(treeBefore, treeOf(userA))
        assertEquals(
            settingsBefore,
            userA.stub.getSettings(GetSettingsRequest.getDefaultInstance()).settings,
        )
        assertEquals(
            accountBefore,
            userA.stub.getAccount(GetAccountRequest.getDefaultInstance()).account,
        )
        server.stop()
    }

    @Test
    fun updateNode_nodeOfA_isNotFound() {
        assertNotFound {
            userB.stub.updateNode(
                UpdateNodeRequest.newBuilder()
                    .setNodeId(nodeA.id)
                    .setName("Taken")
                    .setClosed(true)
                    .setUpdateMask(mask("name", "closed"))
                    .build()
            )
        }
    }

    @Test
    fun updateNode_moveUnderNodeOfA_isNotFound() {
        val nodeB = createNode(userB, "B's node")

        assertNotFound {
            userB.stub.updateNode(
                UpdateNodeRequest.newBuilder()
                    .setNodeId(nodeB.id)
                    .setParentId(nodeA.id)
                    .setUpdateMask(mask("parent_id"))
                    .build()
            )
        }
    }

    @Test
    fun createNode_underNodeOfA_isNotFound() {
        assertNotFound {
            userB.stub.createNode(
                CreateNodeRequest.newBuilder()
                    .setRequestId(UUID.randomUUID().toString())
                    .setParentId(nodeA.id)
                    .setName("Child")
                    .build()
            )
        }
    }

    @Test
    fun createCycle_onNodeOfA_isNotFound() {
        assertNotFound { userB.stub.createCycle(handEntry(nodeA.id, 20)) }
    }

    @Test
    fun updateCycle_stopRunningCycleOfA_isNotFound() {
        assertNotFound { userB.stub.updateCycle(stop(runningA.id, 1)) }
    }

    @Test
    fun updateCycle_lowerMinutesOnCycleOfA_isNotFound() {
        assertNotFound { userB.stub.updateCycle(stop(filedA.id, 1)) }
    }

    @Test
    fun updateCycle_fileToNodeOfA_isNotFound() {
        val inboxB = userB.stub.createCycle(handEntry(null, 20)).cycle

        assertNotFound {
            userB.stub.updateCycle(
                UpdateCycleRequest.newBuilder()
                    .setCycleId(inboxB.id)
                    .setNodeId(nodeA.id)
                    .setUpdateMask(mask("node_id"))
                    .build()
            )
        }
    }

    @Test
    fun listNodes_ofB_showsOnlyAnEmptyInbox() {
        assertEquals(listOf(Model.NodePb.getDefaultInstance()), treeOf(userB))
    }

    @Test
    fun getAccount_ofB_isB() {
        assertNotEquals(
            accountBefore.id,
            userB.stub.getAccount(GetAccountRequest.getDefaultInstance()).account.id,
        )
    }

    @Test
    fun updateSettings_ofB_changesOnlyB() {
        val request =
            UpdateSettingsRequest.newBuilder()
                .setSettings(settings(breakMinutes = 15))
                .setUpdateMask(mask("break_minutes"))
                .build()

        assertEquals(15, userB.stub.updateSettings(request).settings.breakMinutes)
        assertEquals(
            15,
            userB.stub.getSettings(GetSettingsRequest.getDefaultInstance()).settings.breakMinutes,
        )
    }

    private fun treeOf(browser: Browser): List<Model.NodePb> =
        browser.stub
            .listNodes(ListNodesRequest.newBuilder().setIncludeClosed(true).build())
            .nodesList

    private fun assertNotFound(call: () -> Any) {
        val error = assertThrows<StatusRuntimeException> { call() }
        assertEquals(Status.Code.NOT_FOUND, error.status.code, error.status.description)
    }
}
