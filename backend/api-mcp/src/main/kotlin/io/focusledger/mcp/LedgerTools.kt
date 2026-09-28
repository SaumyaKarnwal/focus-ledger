package io.focusledger.mcp

import io.focusledger.core.CycleId
import io.focusledger.core.NodeId
import io.focusledger.core.ServiceError
import io.focusledger.core.ServiceResult
import io.focusledger.core.UserId
import io.focusledger.core.account.AccountService
import io.focusledger.core.account.Settings
import io.focusledger.core.ledger.CreateCycle
import io.focusledger.core.ledger.CreateNode
import io.focusledger.core.ledger.Cycle
import io.focusledger.core.ledger.CycleField
import io.focusledger.core.ledger.CycleUpdate
import io.focusledger.core.ledger.Estimate
import io.focusledger.core.ledger.FocusMode
import io.focusledger.core.ledger.LedgerService
import io.focusledger.core.ledger.ListNodesQuery
import io.focusledger.core.ledger.Node
import io.focusledger.core.ledger.NodeField
import io.focusledger.core.ledger.NodeUpdate
import io.focusledger.core.ledger.Period
import java.time.Clock
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject

/** One MCP tool as the agent sees it. */
internal data class ToolDefinition(
    val name: String,
    val description: String,
    val properties: JsonObject,
    val required: List<String>,
    val readOnly: Boolean,
)

/** The text for the agent. [isError] tells the agent that the call changed nothing. */
internal data class ToolOutput(val text: String, val isError: Boolean = false)

/**
 * The MCP tools. They resolve node paths, convert time zones, and compute summaries, and every rule
 * stays in [LedgerService]. Each call acts for the [UserId] from the token, never for a user named
 * in the arguments.
 */
class LedgerTools(
    private val ledger: LedgerService,
    private val account: AccountService,
    private val clock: Clock = Clock.systemUTC(),
    private val newRequestId: () -> UUID = UUID::randomUUID,
) {
    private val handlers: Map<String, (UserId, ToolArguments) -> String> =
        mapOf(
            LIST_NODES to ::listNodes,
            CREATE_NODE to ::createNode,
            START_CYCLE to ::startCycle,
            STOP_CYCLE to ::stopCycle,
            GET_RUNNING_CYCLE to ::getRunningCycle,
            LOG_CYCLE to ::logCycle,
            FILE_CYCLE to ::fileCycle,
            SET_ESTIMATE to ::setEstimate,
        )

    internal val definitions: List<ToolDefinition> = toolDefinitions

    /** Runs one tool. The core is blocking, so the call runs on the IO dispatcher. */
    internal suspend fun call(userId: UserId, toolName: String, arguments: JsonObject): ToolOutput {
        val handler =
            handlers[toolName] ?: return ToolOutput("Unknown tool ${quoted(toolName)}.", true)
        return withContext(Dispatchers.IO) {
            try {
                ToolOutput(handler(userId, ToolArguments(arguments)))
            } catch (exception: ToolInputException) {
                ToolOutput(exception.message.orEmpty(), isError = true)
            }
        }
    }

    private fun listNodes(userId: UserId, arguments: ToolArguments): String {
        val zone = arguments.timeZone()
        val now = clock.instant()
        val start = arguments.instant("start", zone)
        val end = arguments.instant("end", zone)
        val periodName = arguments.string("period")
        val (period, label) =
            when {
                start != null || end != null -> {
                    if (periodName != null || start == null || end == null) {
                        throw ToolInputException(
                            "Give either period, or both start and end, not a mix."
                        )
                    }
                    if (!end.isAfter(start)) throw ToolInputException("end must be after start.")
                    Period(start, end) to "period"
                }
                periodName == null || periodName == "today" -> dayPeriod(now, zone) to "today"
                periodName == "this_week" -> weekPeriod(now, zone) to "week"
                else ->
                    throw ToolInputException(
                        "Unknown period ${quoted(periodName)}. Use today, this_week, or start and end."
                    )
            }
        val allTime = loadTree(userId)
        val inPeriod = LedgerSummary(allTime.tree) { it.startedAt in period }
        return NodeListing(
                allTime = allTime,
                inPeriod = inPeriod,
                period = period,
                periodLabel = label,
                zone = zone,
                includeClosed = arguments.boolean("include_closed") ?: false,
                now = now,
            )
            .render()
    }

    private fun createNode(userId: UserId, arguments: ToolArguments): String {
        val name = arguments.requiredString("name")
        val requestId = arguments.requestId(CREATE_NODE, newRequestId)
        val summary = loadTree(userId)
        val parent = resolveNode(summary, arguments, "parent_id", "parent_path", required = false)
        val node =
            ledger.createNode(userId, CreateNode(requestId, parent?.id, name, emptyList())).orFail()
        val path =
            (parent?.let { NodePaths(summary).path(it.id) + NodePaths.SEPARATOR } ?: "") +
                NodePaths.escapeName(node.name)
        return "Created ${quoted(path)} (node_id ${node.id.value})."
    }

    private fun startCycle(userId: UserId, arguments: ToolArguments): String {
        val zone = arguments.timeZone()
        val mode = arguments.mode()
        val requestId = arguments.requestId(START_CYCLE, newRequestId)
        val summary = loadTree(userId)
        val node = resolveNode(summary, arguments, required = false)
        val plannedMinutes = arguments.int("minutes") ?: settings(userId).minutesFor(mode)
        val result =
            ledger.createCycle(userId, CreateCycle.Start(requestId, node?.id, mode, plannedMinutes))
        if (result.isSecondRunningCycle()) {
            val running = ledger.getRunningCycle(userId).orFail()
            if (running != null) {
                val paths = NodePaths(loadTree(userId))
                throw ToolInputException(
                    "A cycle is already running: ${describeRunning(running, paths, zone, clock.instant())} " +
                        "Call stop_cycle first."
                )
            }
        }
        val cycle = result.orFail()
        val end = cycle.startedAt.plusSeconds(cycle.plannedMinutes * 60L)
        return "Started ${formatMinutes(cycle.plannedMinutes)} of ${cycle.mode.label} " +
            "${target(summary, cycle)}, from ${formatLocal(cycle.startedAt, zone)} " +
            "to ${formatLocal(end, zone)} ($zone). cycle_id ${cycle.id.value}."
    }

    private fun stopCycle(userId: UserId, arguments: ToolArguments): String {
        val zone = arguments.timeZone()
        val running =
            ledger.getRunningCycle(userId).orFail()
                ?: throw ToolInputException("No cycle is running.")
        val minutes = elapsedMinutes(running, clock.instant()).coerceIn(1, running.plannedMinutes)
        val cycle =
            ledger
                .updateCycle(userId, running.id, CycleUpdate(setOf(CycleField.MINUTES), minutes))
                .orFail()
        return "Stopped ${cycle.mode.label} ${target(loadTree(userId), cycle)}, started " +
            "${formatLocal(cycle.startedAt, zone)} ($zone). Logged ${formatMinutes(minutes)} " +
            "of ${formatMinutes(cycle.plannedMinutes)} planned."
    }

    private fun getRunningCycle(userId: UserId, arguments: ToolArguments): String {
        val zone = arguments.timeZone()
        val running = ledger.getRunningCycle(userId).orFail() ?: return "No cycle is running."
        val paths = NodePaths(loadTree(userId))
        return "Running: ${describeRunning(running, paths, zone, clock.instant())} " +
            "Times are in $zone. cycle_id ${running.id.value}."
    }

    private fun logCycle(userId: UserId, arguments: ToolArguments): String {
        val zone = arguments.timeZone()
        val mode = arguments.mode()
        val startedAt =
            arguments.instant("start", zone) ?: throw ToolInputException("start is required.")
        val minutes = arguments.requiredInt("minutes")
        val requestId = arguments.requestId(LOG_CYCLE, newRequestId)
        val summary = loadTree(userId)
        val node = resolveNode(summary, arguments, required = false)
        val cycle =
            ledger
                .createCycle(
                    userId,
                    CreateCycle.HandEntry(requestId, node?.id, mode, startedAt, minutes),
                )
                .orFail()
        return "Logged ${formatMinutes(minutes)} of ${cycle.mode.label} ${target(summary, cycle)}, " +
            "started ${formatLocal(cycle.startedAt, zone)} ($zone). cycle_id ${cycle.id.value}."
    }

    private fun fileCycle(userId: UserId, arguments: ToolArguments): String {
        val zone = arguments.timeZone()
        val cycleText = arguments.requiredString("cycle_id")
        val cycleId =
            parseUuid(cycleText)?.let(::CycleId)
                ?: throw ToolInputException(
                    "No cycle with cycle_id ${quoted(cycleText)}. " +
                        "Call list_nodes to see the Inbox cycles and their IDs."
                )
        val summary = loadTree(userId)
        val node = requireNode(summary, arguments)
        val cycle =
            ledger
                .updateCycle(
                    userId,
                    cycleId,
                    CycleUpdate(setOf(CycleField.NODE_ID), nodeId = node.id),
                )
                .orFail()
        val length = cycle.minutes?.let(::formatMinutes) ?: "running"
        return "Filed the $length ${cycle.mode.label} cycle from " +
            "${formatLocal(cycle.startedAt, zone)} ($zone) to ${quoted(NodePaths(summary).path(node.id))}."
    }

    private fun setEstimate(userId: UserId, arguments: ToolArguments): String {
        val mode = arguments.mode()
        val cycles = arguments.requiredInt("cycles")
        val summary = loadTree(userId)
        val node = requireNode(summary, arguments)
        val current = node.estimates.firstOrNull { it.mode == mode }
        val cycleMinutes =
            arguments.int("cycle_minutes")
                ?: current?.cycleMinutes
                ?: settings(userId).minutesFor(mode)
        val estimates =
            node.estimates.filter { it.mode != mode } + Estimate(mode, cycleMinutes, cycles)
        ledger
            .updateNode(
                userId,
                node.id,
                NodeUpdate(setOf(NodeField.ESTIMATES), estimates = estimates),
            )
            .orFail()
        val done = summary.estimateProgress(node.id).getValue(mode).doneCycles
        return "Estimate for ${quoted(NodePaths(summary).path(node.id))}: ${mode.label} " +
            "$cycles cycles of ${formatMinutes(cycleMinutes)}. Done so far: $done of $cycles."
    }

    private fun loadTree(userId: UserId): LedgerSummary =
        LedgerSummary(
            ledger.listNodes(userId, ListNodesQuery(includeClosed = true, period = null)).orFail()
        )

    private fun settings(userId: UserId): Settings = account.getSettings(userId).orFail()

    private fun requireNode(summary: LedgerSummary, arguments: ToolArguments): Node =
        checkNotNull(resolveNode(summary, arguments, required = true))

    /**
     * The node that the call names by ID or by path, or null when it names none and [required] is
     * false. The lookup reads only this user's tree, so another user's node is "not found".
     */
    private fun resolveNode(
        summary: LedgerSummary,
        arguments: ToolArguments,
        idArgument: String = "node_id",
        pathArgument: String = "node_path",
        required: Boolean,
    ): Node? {
        val idText = arguments.string(idArgument)
        val path = arguments.string(pathArgument)
        val paths = NodePaths(summary)
        return when {
            idText != null ->
                parseUuid(idText)?.let { summary.node(NodeId(it)) }
                    ?: throw ToolInputException(
                        "No node with $idArgument ${quoted(idText)}. " +
                            "Call list_nodes to see the node paths."
                    )
            path != null ->
                when (val match = paths.resolve(path)) {
                    is PathMatch.Found -> match.node
                    is PathMatch.Ambiguous ->
                        throw ToolInputException(
                            "The path ${quoted(path)} matches ${match.nodes.size} nodes. Call " +
                                "again with $idArgument, or with a longer $pathArgument:\n" +
                                match.nodes.joinToString("\n") { node ->
                                    "- ${quoted(paths.path(node.id))} ($idArgument ${node.id.value})"
                                }
                        )
                    is PathMatch.Missing ->
                        throw ToolInputException(
                            "No node matches the path ${quoted(path)}. " +
                                if (match.suggestions.isEmpty()) {
                                    "Call list_nodes to see the node paths."
                                } else {
                                    "Did you mean " +
                                        match.suggestions.joinToString(
                                            " or ",
                                            transform = ::quoted,
                                        ) +
                                        "?"
                                }
                        )
                }
            required ->
                throw ToolInputException(
                    "Give $pathArgument (for example \"Book / Chapter 1\") or $idArgument."
                )
            else -> null
        }
    }

    private fun target(summary: LedgerSummary, cycle: Cycle): String =
        cycle.nodeId?.let { "on ${quoted(NodePaths(summary).path(it))}" } ?: "in the Inbox"

    private companion object {
        fun parseUuid(text: String): UUID? =
            try {
                UUID.fromString(text)
            } catch (_: IllegalArgumentException) {
                null
            }

        fun Settings.minutesFor(mode: FocusMode): Int =
            when (mode) {
                FocusMode.DEEP_FOCUS -> deepFocusMinutes
                FocusMode.EXECUTION -> executionMinutes
                FocusMode.SHALLOW -> shallowMinutes
            }

        fun ServiceResult<*>.isSecondRunningCycle(): Boolean =
            this is ServiceResult.Failure &&
                error == ServiceError.FailedPrecondition(ServiceError.Rule.SECOND_RUNNING_CYCLE)
    }
}
