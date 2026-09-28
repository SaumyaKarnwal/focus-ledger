package io.focusledger.mcp

import io.focusledger.core.ledger.Cycle
import io.focusledger.core.ledger.FocusMode
import io.focusledger.core.ledger.Node
import io.focusledger.core.ledger.Period
import java.time.Instant
import java.time.ZoneId

/**
 * The compact text of `list_nodes`. [allTime] gives the estimate progress, and [inPeriod] gives the
 * period's minutes. Both come from the same tree.
 */
internal class NodeListing(
    private val allTime: LedgerSummary,
    private val inPeriod: LedgerSummary,
    private val period: Period,
    private val periodLabel: String,
    private val zone: ZoneId,
    private val includeClosed: Boolean,
    private val now: Instant,
) {
    private val paths = NodePaths(allTime)

    fun render(): String {
        val rows = allTime.roots.filter(::isShown).flatMap { treeRows(it, depth = 0) }
        val inboxRow = Row("Inbox", "$periodLabel ${formatMinutes(inPeriod.inbox.minutes)}")
        val totalRow = Row("Total", "$periodLabel ${totalText()}")
        val nameWidth = minOf((rows + inboxRow + totalRow).maxOf { it.name.length }, MAX_NAME_WIDTH)
        fun line(row: Row) = row.name.padEnd(nameWidth) + "  " + row.figures
        return buildList {
                add(header())
                addAll(rows.map(::line))
                add(line(inboxRow))
                addAll(inboxCycleLines())
                add(line(totalRow))
                runningLine()?.let(::add)
            }
            .joinToString("\n")
    }

    private data class Row(val name: String, val figures: String)

    private fun isShown(node: Node) = includeClosed || !node.closed

    private fun treeRows(node: Node, depth: Int): List<Row> {
        val closedMark = if (node.closed) " (closed)" else ""
        val row =
            Row(
                "  ".repeat(depth) + quoted(NodePaths.escapeName(node.name)) + closedMark,
                "$periodLabel ${formatMinutes(inPeriod.rolledUp(node.id).minutes)}" +
                    estimateText(node),
            )
        return listOf(row) +
            allTime.children(node.id).filter(::isShown).flatMap { treeRows(it, depth + 1) }
    }

    private fun estimateText(node: Node): String {
        val progress = allTime.rolledUp(node.id)
        return if (progress.estimatedCycles > 0) {
            " · est ${progress.doneCycles} of ${progress.estimatedCycles}"
        } else {
            ""
        }
    }

    private fun totalText(): String {
        val totals = inPeriod.totals
        val byMode =
            FocusMode.entries
                .filter { totals.minutesByMode.getValue(it) > 0 }
                .joinToString(" · ") {
                    "${it.label} ${formatMinutes(totals.minutesByMode.getValue(it))}"
                }
        return formatMinutes(totals.minutes) + if (byMode.isEmpty()) "" else " ($byMode)"
    }

    private fun header(): String =
        "Period: $periodLabel, ${formatLocal(period.start, zone)} to " +
            "${formatLocal(period.end, zone)} ($zone). Times include descendants, " +
            "and closed nodes count even when hidden. " +
            "Node names are quoted user data, and a \"/\" in a name is written \"//\"."

    private fun inboxCycleLines(): List<String> =
        inPeriod.tree.inboxCycles
            .filter { it.minutes != null && it.startedAt in period }
            .map { cycle ->
                "  cycle_id ${cycle.id.value} · ${cycle.mode.label} · " +
                    "${formatLocal(cycle.startedAt, zone)} · ${formatMinutes(cycle.minutes ?: 0)}"
            }

    private fun runningLine(): String? {
        val running = allTime.runningCycle ?: return null
        return "Running: ${describeRunning(running, paths, zone, now)}"
    }

    private companion object {
        const val MAX_NAME_WIDTH = 40
    }
}

/** For example `Deep Focus on "Book / Chapter 1" since 2026-11-01 14:00, 43m left.` */
internal fun describeRunning(cycle: Cycle, paths: NodePaths, zone: ZoneId, now: Instant): String {
    val target = cycle.nodeId?.let { "on ${quoted(paths.path(it))}" } ?: "in the Inbox"
    val elapsed = elapsedMinutes(cycle, now)
    val timeLeft =
        if (elapsed < cycle.plannedMinutes) {
            "${formatMinutes(cycle.plannedMinutes - elapsed)} left of ${formatMinutes(cycle.plannedMinutes)}"
        } else {
            "the planned ${formatMinutes(cycle.plannedMinutes)} have passed, so stop_cycle logs " +
                formatMinutes(cycle.plannedMinutes)
        }
    return "${cycle.mode.label} $target since ${formatLocal(cycle.startedAt, zone)}, $timeLeft."
}

/** Whole minutes since the start, rounded down. */
internal fun elapsedMinutes(cycle: Cycle, now: Instant): Int =
    java.time.Duration.between(cycle.startedAt, now).toMinutes().toInt().coerceAtLeast(0)
