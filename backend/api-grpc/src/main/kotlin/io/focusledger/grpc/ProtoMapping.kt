package io.focusledger.grpc

import com.google.protobuf.Timestamp
import focusledger.v1.Model
import io.focusledger.core.CycleId
import io.focusledger.core.NodeId
import io.focusledger.core.RequestId
import io.focusledger.core.ServiceError
import io.focusledger.core.account.Account
import io.focusledger.core.account.Settings
import io.focusledger.core.ledger.Cycle
import io.focusledger.core.ledger.Estimate
import io.focusledger.core.ledger.FocusMode
import io.focusledger.core.ledger.Node
import io.focusledger.core.ledger.NodeTree
import io.focusledger.core.ledger.Period
import java.time.Instant
import java.util.UUID

/**
 * A request field that fails before the core sees it. The handler returns it as INVALID_ARGUMENT.
 */
internal class BadRequest(val error: ServiceError.InvalidArgument) :
    Exception(null, null, false, false)

internal fun badRequest(field: String, reason: String): Nothing =
    throw BadRequest(ServiceError.InvalidArgument(field, reason))

internal fun uuid(field: String, value: String): UUID =
    runCatching { UUID.fromString(value) }
        .getOrNull()
        ?.takeIf { it.toString() == value.lowercase() } ?: badRequest(field, "must be a UUID")

internal fun requestId(value: String): RequestId =
    if (value.isEmpty()) badRequest("request_id", "is required")
    else RequestId(uuid("request_id", value))

internal fun nodeId(field: String, value: String): NodeId = NodeId(uuid(field, value))

internal fun cycleId(value: String): CycleId = CycleId(uuid("cycle_id", value))

internal fun Model.FocusMode.toCore(field: String = "mode"): FocusMode =
    when (this) {
        Model.FocusMode.FOCUS_MODE_DEEP_FOCUS -> FocusMode.DEEP_FOCUS
        Model.FocusMode.FOCUS_MODE_EXECUTION -> FocusMode.EXECUTION
        Model.FocusMode.FOCUS_MODE_SHALLOW -> FocusMode.SHALLOW
        Model.FocusMode.FOCUS_MODE_UNSPECIFIED,
        Model.FocusMode.UNRECOGNIZED -> badRequest(field, "must be a known mode")
    }

internal fun FocusMode.toProto(): Model.FocusMode =
    when (this) {
        FocusMode.DEEP_FOCUS -> Model.FocusMode.FOCUS_MODE_DEEP_FOCUS
        FocusMode.EXECUTION -> Model.FocusMode.FOCUS_MODE_EXECUTION
        FocusMode.SHALLOW -> Model.FocusMode.FOCUS_MODE_SHALLOW
    }

internal fun Timestamp.toInstant(): Instant = Instant.ofEpochSecond(seconds, nanos.toLong())

internal fun Instant.toProto(): Timestamp =
    Timestamp.newBuilder().setSeconds(epochSecond).setNanos(nano).build()

internal fun Model.PeriodPb.toCore(): Period = Period(start.toInstant(), end.toInstant())

internal fun Model.EstimatePb.toCore(): Estimate =
    Estimate(mode.toCore("estimates.mode"), cycleMinutes, cycleCount)

internal fun Estimate.toProto(): Model.EstimatePb =
    Model.EstimatePb.newBuilder()
        .setMode(mode.toProto())
        .setCycleMinutes(cycleMinutes)
        .setCycleCount(cycleCount)
        .build()

internal fun Cycle.toProto(): Model.CyclePb =
    Model.CyclePb.newBuilder()
        .setId(id.value.toString())
        .setMode(mode.toProto())
        .setStartedAt(startedAt.toProto())
        .setPlannedMinutes(plannedMinutes)
        .also { builder -> nodeId?.let { builder.setNodeId(it.value.toString()) } }
        .also { builder -> minutes?.let { builder.setMinutes(it) } }
        .build()

internal fun Node.toProto(): Model.NodePb =
    Model.NodePb.newBuilder()
        .setId(id.value.toString())
        .setName(name)
        .setClosed(closed)
        .addAllEstimates(estimates.map { it.toProto() })
        .addAllCycles(cycles.map { it.toProto() })
        .setCreatedAt(createdAt.toProto())
        .also { builder -> parentId?.let { builder.setParentId(it.value.toString()) } }
        .build()

/** The Inbox comes first, as a node with no id and no name, even when it has no cycles. */
internal fun NodeTree.toProto(): List<Model.NodePb> =
    listOf(Model.NodePb.newBuilder().addAllCycles(inboxCycles.map { it.toProto() }).build()) +
        nodes.map { it.toProto() }

internal fun Account.toProto(): Model.AccountPb =
    Model.AccountPb.newBuilder()
        .setId(id.value.toString())
        .setEmail(email)
        .setCreatedAt(createdAt.toProto())
        .build()

internal fun Settings.toProto(): Model.SettingsPb =
    Model.SettingsPb.newBuilder()
        .setDeepFocusMinutes(deepFocusMinutes)
        .setExecutionMinutes(executionMinutes)
        .setShallowMinutes(shallowMinutes)
        .setBreakMinutes(breakMinutes)
        .setSoundEnabled(soundEnabled)
        .setNotificationsEnabled(notificationsEnabled)
        .build()

internal fun Model.SettingsPb.toCore(): Settings =
    Settings(
        deepFocusMinutes,
        executionMinutes,
        shallowMinutes,
        breakMinutes,
        soundEnabled,
        notificationsEnabled,
    )

/**
 * The mask paths, each mapped to its core field. An empty mask or an unknown path is a bad request
 * (rule 7).
 */
internal fun <F> maskFields(paths: List<String>, known: Map<String, F>): Set<F> {
    if (paths.isEmpty()) badRequest("update_mask", "must name at least one field")
    return paths
        .map { path -> known[path] ?: badRequest("update_mask", "has an unknown path: $path") }
        .toSet()
}
