package io.focusledger.grpc

import com.google.protobuf.FieldMask
import com.google.protobuf.Timestamp
import focusledger.v1.LedgerServiceGrpc.LedgerServiceBlockingStub
import focusledger.v1.LedgerServiceOuterClass.CreateCycleRequest
import focusledger.v1.LedgerServiceOuterClass.CreateNodeRequest
import focusledger.v1.LedgerServiceOuterClass.GetAccountRequest
import focusledger.v1.LedgerServiceOuterClass.GetSettingsRequest
import focusledger.v1.LedgerServiceOuterClass.ListNodesRequest
import focusledger.v1.LedgerServiceOuterClass.UpdateCycleRequest
import focusledger.v1.LedgerServiceOuterClass.UpdateNodeRequest
import focusledger.v1.LedgerServiceOuterClass.UpdateSettingsRequest
import focusledger.v1.Model
import io.grpc.Status
import io.grpc.StatusRuntimeException
import java.util.UUID
import java.util.stream.Stream
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.Arguments
import org.junit.jupiter.params.provider.MethodSource

class RpcTest {
    private val server = GrpcTestServer()

    @AfterEach
    fun stop() {
        server.stop()
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("callsThatNeedASession")
    fun rpc_withNoSession_isUnauthenticated(
        name: String,
        call: (LedgerServiceBlockingStub) -> Any,
    ) {
        assertUnauthenticated { call(server.browser().stub) }
    }

    @Test
    fun listNodes_returnsInboxFirstThenNodes() {
        val browser = server.signedIn()
        val node = createNode(browser, "Website")
        browser.stub.createCycle(handEntry(nodeId = null, minutes = 25))

        val nodes = browser.stub.listNodes(ListNodesRequest.getDefaultInstance()).nodesList

        assertEquals(listOf("", node.id), nodes.map { it.id })
        assertEquals(listOf(25), nodes.first().cyclesList.map { it.minutes })
        assertFalse(nodes.first().cyclesList.single().hasNodeId())
    }

    @Test
    fun createCycle_startThenRepeat_returnsTheSameRunningCycle() {
        val browser = server.signedIn()
        val requestId = UUID.randomUUID().toString()
        val start =
            CreateCycleRequest.newBuilder()
                .setRequestId(requestId)
                .setMode(DEEP)
                .setPlannedMinutes(90)
                .build()

        val first = browser.stub.createCycle(start).cycle
        val repeat = browser.stub.createCycle(start).cycle

        assertEquals(first, repeat)
        assertFalse(first.hasMinutes())
    }

    @Test
    fun createCycle_secondStart_isFailedPrecondition() {
        val browser = server.signedIn()
        browser.stub.createCycle(start())

        assertStatus(Status.Code.FAILED_PRECONDITION) { browser.stub.createCycle(start()) }
    }

    @Test
    fun createCycle_startWithStartedAt_isInvalid() {
        val browser = server.signedIn()

        assertStatus(Status.Code.INVALID_ARGUMENT) {
            browser.stub.createCycle(start().toBuilder().setStartedAt(STARTED_AT).build())
        }
    }

    @Test
    fun createCycle_handEntryWithoutStartedAt_isInvalid() {
        val browser = server.signedIn()

        assertStatus(Status.Code.INVALID_ARGUMENT) {
            browser.stub.createCycle(handEntry(null, 25).toBuilder().clearStartedAt().build())
        }
    }

    @Test
    fun createCycle_handEntryWithOtherPlannedMinutes_isInvalid() {
        val browser = server.signedIn()

        assertStatus(Status.Code.INVALID_ARGUMENT) {
            browser.stub.createCycle(handEntry(null, 25).toBuilder().setPlannedMinutes(30).build())
        }
    }

    @Test
    fun createCycle_unspecifiedMode_isInvalid() {
        val browser = server.signedIn()

        assertStatus(Status.Code.INVALID_ARGUMENT) {
            browser.stub.createCycle(
                start().toBuilder().setMode(Model.FocusMode.FOCUS_MODE_UNSPECIFIED).build()
            )
        }
    }

    @Test
    fun create_missingOrMalformedRequestId_isInvalid() {
        val browser = server.signedIn()

        assertStatus(Status.Code.INVALID_ARGUMENT) {
            browser.stub.createCycle(start().toBuilder().clearRequestId().build())
        }
        assertStatus(Status.Code.INVALID_ARGUMENT) {
            browser.stub.createNode(
                CreateNodeRequest.newBuilder().setRequestId("not-a-uuid").setName("Node").build()
            )
        }
    }

    @Test
    fun updateNode_missingMask_isInvalid() {
        val browser = server.signedIn()
        val node = createNode(browser, "Node")

        assertStatus(Status.Code.INVALID_ARGUMENT) {
            browser.stub.updateNode(
                UpdateNodeRequest.newBuilder().setNodeId(node.id).setName("Renamed").build()
            )
        }
    }

    @Test
    fun updateNode_unknownMaskPath_isInvalid() {
        val browser = server.signedIn()
        val node = createNode(browser, "Node")

        assertStatus(Status.Code.INVALID_ARGUMENT) {
            browser.stub.updateNode(
                UpdateNodeRequest.newBuilder()
                    .setNodeId(node.id)
                    .setUpdateMask(mask("colour"))
                    .build()
            )
        }
    }

    @Test
    fun updateNode_parentIdInMaskWithNoValue_movesToRoot() {
        val browser = server.signedIn()
        val parent = createNode(browser, "Parent")
        val child = createNode(browser, "Child", parentId = parent.id)

        val moved =
            browser.stub
                .updateNode(
                    UpdateNodeRequest.newBuilder()
                        .setNodeId(child.id)
                        .setUpdateMask(mask("parent_id"))
                        .build()
                )
                .node

        assertFalse(moved.hasParentId())
    }

    @Test
    fun updateNode_moveUnderOwnChild_isFailedPrecondition() {
        val browser = server.signedIn()
        val parent = createNode(browser, "Parent")
        val child = createNode(browser, "Child", parentId = parent.id)

        assertStatus(Status.Code.FAILED_PRECONDITION) {
            browser.stub.updateNode(
                UpdateNodeRequest.newBuilder()
                    .setNodeId(parent.id)
                    .setParentId(child.id)
                    .setUpdateMask(mask("parent_id"))
                    .build()
            )
        }
    }

    @Test
    fun updateCycle_missingMask_isInvalid() {
        val browser = server.signedIn()
        val cycle = browser.stub.createCycle(start()).cycle

        assertStatus(Status.Code.INVALID_ARGUMENT) {
            browser.stub.updateCycle(
                UpdateCycleRequest.newBuilder().setCycleId(cycle.id).setMinutes(10).build()
            )
        }
    }

    @Test
    fun updateCycle_stopThenLowerMinutes_isFailedPrecondition() {
        val browser = server.signedIn()
        val cycle = browser.stub.createCycle(start()).cycle
        browser.stub.updateCycle(stop(cycle.id, 30))

        assertStatus(Status.Code.FAILED_PRECONDITION) {
            browser.stub.updateCycle(stop(cycle.id, 20))
        }
    }

    @Test
    fun updateSettings_missingMask_isInvalid() {
        val browser = server.signedIn()

        assertStatus(Status.Code.INVALID_ARGUMENT) {
            browser.stub.updateSettings(
                UpdateSettingsRequest.newBuilder().setSettings(settings(breakMinutes = 10)).build()
            )
        }
    }

    @Test
    fun updateSettings_masked_changesOnlyThatField() {
        val browser = server.signedIn()

        val updated =
            browser.stub
                .updateSettings(
                    UpdateSettingsRequest.newBuilder()
                        .setSettings(settings(breakMinutes = 10))
                        .setUpdateMask(mask("break_minutes"))
                        .build()
                )
                .settings

        assertEquals(10, updated.breakMinutes)
        assertEquals(90, updated.deepFocusMinutes)
    }

    private fun assertStatus(code: Status.Code, call: () -> Any) {
        val error = assertThrows<StatusRuntimeException> { call() }
        assertEquals(code, error.status.code, error.status.description)
    }

    companion object {
        val DEEP: Model.FocusMode = Model.FocusMode.FOCUS_MODE_DEEP_FOCUS
        val STARTED_AT: Timestamp = Timestamp.newBuilder().setSeconds(1_790_000_000).build()
        private val SOME_ID = UUID.randomUUID().toString()

        fun mask(vararg paths: String): FieldMask =
            FieldMask.newBuilder().addAllPaths(paths.toList()).build()

        fun start(): CreateCycleRequest =
            CreateCycleRequest.newBuilder()
                .setRequestId(UUID.randomUUID().toString())
                .setMode(DEEP)
                .setPlannedMinutes(50)
                .build()

        fun handEntry(nodeId: String?, minutes: Int): CreateCycleRequest =
            CreateCycleRequest.newBuilder()
                .setRequestId(UUID.randomUUID().toString())
                .setMode(Model.FocusMode.FOCUS_MODE_EXECUTION)
                .setStartedAt(STARTED_AT)
                .setMinutes(minutes)
                .also { builder -> nodeId?.let { builder.setNodeId(it) } }
                .build()

        fun stop(cycleId: String, minutes: Int): UpdateCycleRequest =
            UpdateCycleRequest.newBuilder()
                .setCycleId(cycleId)
                .setMinutes(minutes)
                .setUpdateMask(mask("minutes"))
                .build()

        fun settings(breakMinutes: Int): Model.SettingsPb =
            Model.SettingsPb.newBuilder()
                .setDeepFocusMinutes(120)
                .setExecutionMinutes(50)
                .setShallowMinutes(25)
                .setBreakMinutes(breakMinutes)
                .build()

        fun createNode(browser: Browser, name: String, parentId: String? = null): Model.NodePb =
            browser.stub
                .createNode(
                    CreateNodeRequest.newBuilder()
                        .setRequestId(UUID.randomUUID().toString())
                        .setName(name)
                        .also { builder -> parentId?.let { builder.setParentId(it) } }
                        .build()
                )
                .node

        /** Every RPC except SignIn and SignOut, which work without a session. */
        @JvmStatic
        fun callsThatNeedASession(): Stream<Arguments> =
            Stream.of(
                Arguments.of(
                    "GetAccount",
                    { stub: LedgerServiceBlockingStub ->
                        stub.getAccount(GetAccountRequest.getDefaultInstance())
                    },
                ),
                Arguments.of(
                    "GetSettings",
                    { stub: LedgerServiceBlockingStub ->
                        stub.getSettings(GetSettingsRequest.getDefaultInstance())
                    },
                ),
                Arguments.of(
                    "UpdateSettings",
                    { stub: LedgerServiceBlockingStub ->
                        stub.updateSettings(
                            UpdateSettingsRequest.newBuilder()
                                .setSettings(settings(10))
                                .setUpdateMask(mask("break_minutes"))
                                .build()
                        )
                    },
                ),
                Arguments.of(
                    "CreateNode",
                    { stub: LedgerServiceBlockingStub ->
                        stub.createNode(
                            CreateNodeRequest.newBuilder()
                                .setRequestId(UUID.randomUUID().toString())
                                .setName("Node")
                                .build()
                        )
                    },
                ),
                Arguments.of(
                    "UpdateNode",
                    { stub: LedgerServiceBlockingStub ->
                        stub.updateNode(
                            UpdateNodeRequest.newBuilder()
                                .setNodeId(SOME_ID)
                                .setName("x")
                                .setUpdateMask(mask("name"))
                                .build()
                        )
                    },
                ),
                Arguments.of(
                    "ListNodes",
                    { stub: LedgerServiceBlockingStub ->
                        stub.listNodes(ListNodesRequest.getDefaultInstance())
                    },
                ),
                Arguments.of(
                    "CreateCycle",
                    { stub: LedgerServiceBlockingStub -> stub.createCycle(start()) },
                ),
                Arguments.of(
                    "UpdateCycle",
                    { stub: LedgerServiceBlockingStub -> stub.updateCycle(stop(SOME_ID, 5)) },
                ),
            )
    }
}
