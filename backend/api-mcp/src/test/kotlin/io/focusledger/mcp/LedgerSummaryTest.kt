package io.focusledger.mcp

import io.focusledger.core.CycleId
import io.focusledger.core.NodeId
import io.focusledger.core.ledger.Cycle
import io.focusledger.core.ledger.Estimate
import io.focusledger.core.ledger.FocusMode
import io.focusledger.core.ledger.Node
import io.focusledger.core.ledger.NodeTree
import io.focusledger.core.ledger.Period
import java.io.File
import java.time.Instant
import java.time.ZoneId
import java.util.UUID
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

/** The roll-ups against the expected results in `testdata/ledger-example.json`, shared with web. */
class LedgerSummaryTest {
    private val example =
        Json.parseToJsonElement(
                File(System.getProperty("focusledger.testdata"), "ledger-example.json").readText()
            )
            .jsonObject
    private val expected = example.obj("expected")
    private val now = Instant.parse(example.string("now"))
    private val tree = parseTree(example.obj("listNodesResponse"))
    private val summary = LedgerSummary(tree)

    @Test
    fun ownAndRolledUp_matchTheExpectedTree() {
        expected
            .array("tree")
            .map { it.jsonObject }
            .forEach { row ->
                val nodeId = NodeId(UUID.fromString(row.string("nodeId")))
                assertEquals(
                    figures(row.obj("own")),
                    summary.own(nodeId),
                    "own of ${row.string("nodeId")}",
                )
                assertEquals(
                    figures(row.obj("rolledUp")),
                    summary.rolledUp(nodeId),
                    "rolledUp of ${row.string("nodeId")}",
                )
            }
    }

    @Test
    fun totalsInboxAndRunningCycle_matchTheExpectedValues() {
        assertEquals(minutesByMode(expected.obj("totals")), summary.totals.minutesByMode)
        assertEquals(expected.obj("totals").int("minutes"), summary.totals.minutes)
        assertEquals(expected.obj("inbox").int("doneCycles"), summary.inbox.doneCycles)
        assertEquals(expected.obj("inbox").int("minutes"), summary.inbox.minutes)
        assertEquals(expected.string("runningCycleId"), summary.runningCycle?.id?.value.toString())
    }

    @Test
    fun estimateProgress_matchesTheExpectedValues() {
        expected
            .array("estimateProgress")
            .map { it.jsonObject }
            .forEach { row ->
                val progress =
                    summary.estimateProgress(NodeId(UUID.fromString(row.string("nodeId"))))
                val byMode = row.obj("byMode")
                assertEquals(
                    FocusMode.entries.associateWith { mode ->
                        byMode.obj(modeKey(mode)).let {
                            ModeProgress(it.int("doneCycles"), it.int("estimatedCycles"))
                        }
                    },
                    progress,
                    "estimate progress of ${row.string("nodeId")}",
                )
            }
    }

    @Test
    fun periods_matchInUtcAndInAZoneWithADaylightSavingChange() {
        expected
            .array("periods")
            .map { it.jsonObject }
            .forEach { row ->
                val zone = ZoneId.of(row.string("timeZone"))
                val today = dayPeriod(now, zone)
                val week = weekPeriod(now, zone)
                assertEquals(period(row.obj("today")), today, "today in $zone")
                assertEquals(period(row.obj("week")), week, "week in $zone")
                assertEquals(
                    minutesByMode(row.obj("todayTotals")),
                    LedgerSummary(tree) { it.startedAt in today }.totals.minutesByMode,
                    "today's totals in $zone",
                )
                assertEquals(
                    minutesByMode(row.obj("weekTotals")),
                    LedgerSummary(tree) { it.startedAt in week }.totals.minutesByMode,
                    "the week's totals in $zone",
                )
            }
    }

    private fun figures(json: JsonObject) =
        Figures(json.int("doneCycles"), json.int("estimatedCycles"), minutesByMode(json))

    private fun minutesByMode(json: JsonObject): Map<FocusMode, Int> =
        FocusMode.entries.associateWith { json.obj("minutesByMode").int(modeKey(it)) }

    private fun period(json: JsonObject) =
        Period(Instant.parse(json.string("start")), Instant.parse(json.string("end")))

    private companion object {
        fun modeKey(mode: FocusMode) = "FOCUS_MODE_${mode.name}"

        fun mode(text: String) = FocusMode.valueOf(text.removePrefix("FOCUS_MODE_"))

        /** A ListNodesResponse in the proto3 JSON mapping. The node with no id is the Inbox. */
        fun parseTree(response: JsonObject): NodeTree {
            val nodes = response.array("nodes").map { it.jsonObject }
            val (inbox, named) = nodes.partition { it.optionalString("id").isNullOrEmpty() }
            return NodeTree(
                nodes = named.map(::parseNode),
                inboxCycles = inbox.flatMap { it.optionalArray("cycles") }.map(::parseCycle),
            )
        }

        fun parseNode(json: JsonObject) =
            Node(
                id = NodeId(UUID.fromString(json.string("id"))),
                parentId = json.optionalString("parentId")?.let { NodeId(UUID.fromString(it)) },
                name = json.string("name"),
                closed = json["closed"]?.jsonPrimitive?.boolean ?: false,
                estimates =
                    json.optionalArray("estimates").map {
                        Estimate(
                            mode(it.string("mode")),
                            it.int("cycleMinutes"),
                            it.int("cycleCount"),
                        )
                    },
                cycles = json.optionalArray("cycles").map(::parseCycle),
                createdAt = Instant.parse(json.string("createdAt")),
            )

        fun parseCycle(json: JsonObject) =
            Cycle(
                id = CycleId(UUID.fromString(json.string("id"))),
                nodeId = json.optionalString("nodeId")?.let { NodeId(UUID.fromString(it)) },
                mode = mode(json.string("mode")),
                startedAt = Instant.parse(json.string("startedAt")),
                plannedMinutes = json.int("plannedMinutes"),
                minutes = json["minutes"]?.jsonPrimitive?.int,
            )

        fun JsonObject.obj(name: String) = getValue(name).jsonObject

        fun JsonObject.array(name: String): List<JsonElement> = getValue(name).jsonArray

        fun JsonObject.optionalArray(name: String): List<JsonObject> =
            get(name)?.jsonArray?.map { it.jsonObject }.orEmpty()

        fun JsonObject.string(name: String) = getValue(name).jsonPrimitive.content

        fun JsonObject.optionalString(name: String) = get(name)?.jsonPrimitive?.content

        fun JsonObject.int(name: String) = getValue(name).jsonPrimitive.int
    }
}
