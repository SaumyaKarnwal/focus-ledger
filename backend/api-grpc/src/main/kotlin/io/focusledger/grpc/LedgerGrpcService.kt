package io.focusledger.grpc

import com.linecorp.armeria.common.HttpHeaderNames
import focusledger.v1.LedgerServiceGrpcKt
import focusledger.v1.LedgerServiceOuterClass.CreateCycleRequest
import focusledger.v1.LedgerServiceOuterClass.CreateCycleResponse
import focusledger.v1.LedgerServiceOuterClass.CreateNodeRequest
import focusledger.v1.LedgerServiceOuterClass.CreateNodeResponse
import focusledger.v1.LedgerServiceOuterClass.GetAccountRequest
import focusledger.v1.LedgerServiceOuterClass.GetAccountResponse
import focusledger.v1.LedgerServiceOuterClass.GetSettingsRequest
import focusledger.v1.LedgerServiceOuterClass.GetSettingsResponse
import focusledger.v1.LedgerServiceOuterClass.ListNodesRequest
import focusledger.v1.LedgerServiceOuterClass.ListNodesResponse
import focusledger.v1.LedgerServiceOuterClass.SignInRequest
import focusledger.v1.LedgerServiceOuterClass.SignInResponse
import focusledger.v1.LedgerServiceOuterClass.SignOutRequest
import focusledger.v1.LedgerServiceOuterClass.SignOutResponse
import focusledger.v1.LedgerServiceOuterClass.UpdateCycleRequest
import focusledger.v1.LedgerServiceOuterClass.UpdateCycleResponse
import focusledger.v1.LedgerServiceOuterClass.UpdateNodeRequest
import focusledger.v1.LedgerServiceOuterClass.UpdateNodeResponse
import focusledger.v1.LedgerServiceOuterClass.UpdateSettingsRequest
import focusledger.v1.LedgerServiceOuterClass.UpdateSettingsResponse
import io.focusledger.core.ServiceError
import io.focusledger.core.UserId
import io.focusledger.core.account.AccountService
import io.focusledger.core.account.SettingsField
import io.focusledger.core.account.SettingsUpdate
import io.focusledger.core.account.SignInCredential
import io.focusledger.core.ledger.CreateCycle
import io.focusledger.core.ledger.CreateNode
import io.focusledger.core.ledger.CycleField
import io.focusledger.core.ledger.CycleUpdate
import io.focusledger.core.ledger.LedgerService
import io.focusledger.core.ledger.ListNodesQuery
import io.focusledger.core.ledger.NodeField
import io.focusledger.core.ledger.NodeUpdate
import io.grpc.Status
import io.grpc.StatusException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * The gRPC handlers of LedgerService. They translate between protobuf and the core and hold no
 * rules. The user comes from [SessionInterceptor], never from a request field.
 */
internal class LedgerGrpcService(
    private val ledger: LedgerService,
    private val account: AccountService,
    private val cookies: SessionCookies,
) : LedgerServiceGrpcKt.LedgerServiceCoroutineImplBase() {

    override suspend fun signIn(request: SignInRequest): SignInResponse {
        val credential =
            when (request.credentialCase) {
                SignInRequest.CredentialCase.GOOGLE_ID_TOKEN ->
                    SignInCredential.GoogleIdToken(request.googleIdToken)
                else ->
                    throw StatusException(
                        ServiceError.InvalidArgument("credential", "is required").toStatus()
                    )
            }
        val requestContext = SessionInterceptor.REQUEST_CONTEXT.get()
        val signedIn = blocking { account.signIn(credential).orThrow() }
        requestContext.addAdditionalResponseHeader(
            HttpHeaderNames.SET_COOKIE,
            cookies.issue(signedIn.id),
        )
        return SignInResponse.newBuilder().setAccount(signedIn.toProto()).build()
    }

    override suspend fun signOut(request: SignOutRequest): SignOutResponse {
        SessionInterceptor.REQUEST_CONTEXT.get()
            .addAdditionalResponseHeader(HttpHeaderNames.SET_COOKIE, cookies.clear())
        return SignOutResponse.getDefaultInstance()
    }

    override suspend fun getAccount(request: GetAccountRequest): GetAccountResponse =
        withUser { userId ->
            GetAccountResponse.newBuilder()
                .setAccount(account.getAccount(userId).orThrow().toProto())
                .build()
        }

    override suspend fun getSettings(request: GetSettingsRequest): GetSettingsResponse =
        withUser { userId ->
            GetSettingsResponse.newBuilder()
                .setSettings(account.getSettings(userId).orThrow().toProto())
                .build()
        }

    override suspend fun updateSettings(request: UpdateSettingsRequest): UpdateSettingsResponse =
        withUser { userId ->
            val update =
                SettingsUpdate(
                    maskFields(request.updateMask.pathsList, SETTINGS_PATHS),
                    request.settings.toCore(),
                )
            UpdateSettingsResponse.newBuilder()
                .setSettings(account.updateSettings(userId, update).orThrow().toProto())
                .build()
        }

    override suspend fun createNode(request: CreateNodeRequest): CreateNodeResponse =
        withUser { userId ->
            val create =
                CreateNode(
                    requestId = requestId(request.requestId),
                    parentId =
                        if (request.hasParentId()) nodeId("parent_id", request.parentId) else null,
                    name = request.name,
                    estimates = request.estimatesList.map { it.toCore() },
                )
            CreateNodeResponse.newBuilder()
                .setNode(ledger.createNode(userId, create).orThrow().toProto())
                .build()
        }

    override suspend fun updateNode(request: UpdateNodeRequest): UpdateNodeResponse =
        withUser { userId ->
            val update =
                NodeUpdate(
                    mask = maskFields(request.updateMask.pathsList, NODE_PATHS),
                    name = request.name,
                    parentId =
                        if (request.hasParentId()) nodeId("parent_id", request.parentId) else null,
                    closed = request.closed,
                    estimates = request.estimatesList.map { it.toCore() },
                )
            val node =
                ledger.updateNode(userId, nodeId("node_id", request.nodeId), update).orThrow()
            UpdateNodeResponse.newBuilder().setNode(node.toProto()).build()
        }

    override suspend fun listNodes(request: ListNodesRequest): ListNodesResponse =
        withUser { userId ->
            val query =
                ListNodesQuery(
                    request.includeClosed,
                    if (request.hasPeriod()) request.period.toCore() else null,
                )
            ListNodesResponse.newBuilder()
                .addAllNodes(ledger.listNodes(userId, query).orThrow().toProto())
                .build()
        }

    override suspend fun createCycle(request: CreateCycleRequest): CreateCycleResponse =
        withUser { userId ->
            CreateCycleResponse.newBuilder()
                .setCycle(ledger.createCycle(userId, request.toCore()).orThrow().toProto())
                .build()
        }

    override suspend fun updateCycle(request: UpdateCycleRequest): UpdateCycleResponse =
        withUser { userId ->
            val update =
                CycleUpdate(
                    mask = maskFields(request.updateMask.pathsList, CYCLE_PATHS),
                    minutes = if (request.hasMinutes()) request.minutes else null,
                    nodeId = if (request.hasNodeId()) nodeId("node_id", request.nodeId) else null,
                )
            val cycle = ledger.updateCycle(userId, cycleId(request.cycleId), update).orThrow()
            UpdateCycleResponse.newBuilder().setCycle(cycle.toProto()).build()
        }

    /**
     * Without minutes, a Start. With minutes, a hand entry (docs/api.md, "Cycles messages"). A
     * request that fits neither shape is a bad request.
     */
    private fun CreateCycleRequest.toCore(): CreateCycle {
        val requestId = requestId(requestId)
        val nodeId = if (hasNodeId()) nodeId("node_id", nodeId) else null
        val mode = mode.toCore()
        if (!hasMinutes()) {
            if (hasStartedAt()) badRequest("started_at", "must not be set on a Start")
            return CreateCycle.Start(requestId, nodeId, mode, plannedMinutes)
        }
        if (!hasStartedAt()) badRequest("started_at", "is required for a hand entry")
        if (plannedMinutes != 0 && plannedMinutes != minutes) {
            badRequest("planned_minutes", "must equal minutes for a hand entry")
        }
        return CreateCycle.HandEntry(requestId, nodeId, mode, startedAt.toInstant(), minutes)
    }

    /**
     * Runs [block] for the session's user off the event loop, because the core calls block on JDBC.
     * A [BadRequest] from the mapping becomes INVALID_ARGUMENT.
     */
    private suspend fun <T> withUser(block: (UserId) -> T): T {
        val userId =
            SessionInterceptor.USER_ID.get() ?: throw StatusException(Status.UNAUTHENTICATED)
        return blocking { block(userId) }
    }

    private suspend fun <T> blocking(block: () -> T): T =
        withContext(Dispatchers.IO) {
            try {
                block()
            } catch (bad: BadRequest) {
                throw StatusException(bad.error.toStatus())
            }
        }

    private companion object {
        val NODE_PATHS =
            mapOf(
                "name" to NodeField.NAME,
                "parent_id" to NodeField.PARENT_ID,
                "closed" to NodeField.CLOSED,
                "estimates" to NodeField.ESTIMATES,
            )
        val CYCLE_PATHS = mapOf("minutes" to CycleField.MINUTES, "node_id" to CycleField.NODE_ID)
        val SETTINGS_PATHS =
            mapOf(
                "deep_focus_minutes" to SettingsField.DEEP_FOCUS_MINUTES,
                "execution_minutes" to SettingsField.EXECUTION_MINUTES,
                "shallow_minutes" to SettingsField.SHALLOW_MINUTES,
                "break_minutes" to SettingsField.BREAK_MINUTES,
                "sound_enabled" to SettingsField.SOUND_ENABLED,
                "notifications_enabled" to SettingsField.NOTIFICATIONS_ENABLED,
            )
    }
}
