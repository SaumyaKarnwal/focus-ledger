package io.focusledger.mcp

import io.focusledger.core.NodeId
import io.focusledger.core.ledger.Cycle
import io.focusledger.core.ledger.FocusMode
import io.focusledger.core.ledger.Node
import io.focusledger.core.ledger.NodeTree
import io.focusledger.core.ledger.Period
import java.time.DayOfWeek
import java.time.Instant
import java.time.ZoneId
import java.time.temporal.TemporalAdjusters

/** The local day in [zone] that holds [now], in UTC. */
internal fun dayPeriod(now: Instant, zone: ZoneId): Period {
    val day = now.atZone(zone).toLocalDate()
    return Period(
        day.atStartOfDay(zone).toInstant(),
        day.plusDays(1).atStartOfDay(zone).toInstant(),
    )
}

/** The local week in [zone] that holds [now], in UTC. A week starts on Monday. */
internal fun weekPeriod(now: Instant, zone: ZoneId): Period {
    val monday =
        now.atZone(zone).toLocalDate().with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
    return Period(
        monday.atStartOfDay(zone).toInstant(),
        monday.plusWeeks(1).atStartOfDay(zone).toInstant(),
    )
}

internal operator fun Period.contains(instant: Instant): Boolean =
    !instant.isBefore(start) && instant.isBefore(end)

/** Logged cycles and estimates. A running cycle adds no minutes and no count. */
internal data class Figures(
    val doneCycles: Int,
    val estimatedCycles: Int,
    val minutesByMode: Map<FocusMode, Int>,
) {
    val minutes: Int
        get() = minutesByMode.values.sum()

    operator fun plus(other: Figures) =
        Figures(
            doneCycles + other.doneCycles,
            estimatedCycles + other.estimatedCycles,
            FocusMode.entries.associateWith {
                minutesByMode.getValue(it) + other.minutesByMode.getValue(it)
            },
        )

    companion object {
        val ZERO = Figures(0, 0, FocusMode.entries.associateWith { 0 })

        fun of(cycles: List<Cycle>, estimatedCycles: Int = 0): Figures {
            val logged = cycles.filter { it.minutes != null }
            return Figures(
                doneCycles = logged.size,
                estimatedCycles = estimatedCycles,
                minutesByMode =
                    FocusMode.entries.associateWith { mode ->
                        logged.filter { it.mode == mode }.sumOf { it.minutes ?: 0 }
                    },
            )
        }
    }
}

/** A node's own logged cycles in one mode against its own estimate for that mode. */
internal data class ModeProgress(val doneCycles: Int, val estimatedCycles: Int)

/**
 * The roll-ups for agents, computed from one [NodeTree]. The web app computes the same figures in
 * the browser, and both test against `testdata/ledger-example.json`. The node figures cover the
 * cycles for which [counts] is true.
 */
internal class LedgerSummary(
    val tree: NodeTree,
    private val counts: (Cycle) -> Boolean = { true },
) {
    private val nodesById = tree.nodes.associateBy { it.id }
    private val childrenByParent =
        tree.nodes.groupBy { it.parentId?.takeIf(nodesById::containsKey) }

    val roots: List<Node>
        get() = childrenByParent[null].orEmpty()

    fun children(nodeId: NodeId): List<Node> = childrenByParent[nodeId].orEmpty()

    /** The node's own cycles and estimates. */
    fun own(nodeId: NodeId): Figures {
        val node = nodesById.getValue(nodeId)
        return Figures.of(node.cycles.filter(counts), node.estimates.sumOf { it.cycleCount })
    }

    /** The node and all of its descendants, closed ones included. */
    fun rolledUp(nodeId: NodeId): Figures =
        children(nodeId).fold(own(nodeId)) { figures, child -> figures + rolledUp(child.id) }

    fun estimateProgress(nodeId: NodeId): Map<FocusMode, ModeProgress> {
        val node = nodesById.getValue(nodeId)
        val logged = node.cycles.filter { counts(it) && it.minutes != null }
        return FocusMode.entries.associateWith { mode ->
            ModeProgress(
                doneCycles = logged.count { it.mode == mode },
                estimatedCycles = node.estimates.filter { it.mode == mode }.sumOf { it.cycleCount },
            )
        }
    }

    /** The Inbox enters no node's figures. */
    val inbox: Figures
        get() = Figures.of(tree.inboxCycles.filter(counts))

    /** Every logged cycle: the Inbox and the nodes, closed ones included. */
    val totals: Figures
        get() =
            tree.nodes.fold(inbox) { figures, node ->
                figures + Figures.of(node.cycles.filter(counts))
            }

    val runningCycle: Cycle?
        get() = allCycles().firstOrNull { it.minutes == null }

    /** The node names from the root to [nodeId], for example `["Book", "Chapter 1"]`. */
    fun pathOf(nodeId: NodeId): List<String> =
        generateSequence(nodesById[nodeId]) { node -> node.parentId?.let(nodesById::get) }
            .map { it.name }
            .toList()
            .reversed()

    fun node(nodeId: NodeId): Node? = nodesById[nodeId]

    private fun allCycles(): Sequence<Cycle> =
        tree.inboxCycles.asSequence() + tree.nodes.asSequence().flatMap { it.cycles }
}
