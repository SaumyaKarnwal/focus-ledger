package io.focusledger.mcp

import io.focusledger.core.ledger.FocusMode
import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject

internal const val LIST_NODES = "list_nodes"
internal const val CREATE_NODE = "create_node"
internal const val START_CYCLE = "start_cycle"
internal const val STOP_CYCLE = "stop_cycle"
internal const val GET_RUNNING_CYCLE = "get_running_cycle"
internal const val LOG_CYCLE = "log_cycle"
internal const val FILE_CYCLE = "file_cycle"
internal const val SET_ESTIMATE = "set_estimate"

// The agent's model reads these descriptions on every turn, so they stay short.
internal val toolDefinitions: List<ToolDefinition> =
    listOf(
        ToolDefinition(
            name = LIST_NODES,
            description =
                "The user's work tree with the time per node for a period, estimate progress, " +
                    "the Inbox cycles, the running cycle, and the total. Use it to find node paths.",
            properties =
                properties {
                    string("period", "today (default) or this_week (weeks start on Monday).")
                    string("start", "Instead of period: the start, ISO 8601.")
                    string("end", "Instead of period: the end (excluded), ISO 8601.")
                    boolean("include_closed", "Also list closed nodes. Default false.")
                    timeZone()
                },
            required = emptyList(),
            readOnly = true,
        ),
        ToolDefinition(
            name = CREATE_NODE,
            description = "Creates a node under a parent node, or at the root.",
            properties =
                properties {
                    string("name", "The new node's name.")
                    string("parent_path", "The parent's path, for example \"Book / Chapter 1\".")
                    string("parent_id", "Instead of parent_path: the parent's node_id.")
                    requestId()
                },
            required = listOf("name"),
            readOnly = false,
        ),
        ToolDefinition(
            name = START_CYCLE,
            description =
                "Starts a timed cycle now. Leave out the node to start it in the Inbox. " +
                    "Only one cycle runs at a time.",
            properties =
                properties {
                    node()
                    mode()
                    integer(
                        "minutes",
                        "The planned length. Default: the user's setting for the mode.",
                    )
                    requestId()
                    timeZone()
                },
            required = listOf("mode"),
            readOnly = false,
        ),
        ToolDefinition(
            name = STOP_CYCLE,
            description =
                "Stops the running cycle and logs the minutes so far, at least 1 and at most " +
                    "the planned length.",
            properties = properties { timeZone() },
            required = emptyList(),
            readOnly = false,
        ),
        ToolDefinition(
            name = GET_RUNNING_CYCLE,
            description = "The running cycle and the time left.",
            properties = properties { timeZone() },
            required = emptyList(),
            readOnly = true,
        ),
        ToolDefinition(
            name = LOG_CYCLE,
            description = "Logs finished work by hand. Leave out the node to log it to the Inbox.",
            properties =
                properties {
                    node()
                    mode()
                    string(
                        "start",
                        "When the work started, ISO 8601. A time with no offset is read in time_zone.",
                    )
                    integer("minutes", "How long the work took, 1 to 1440.")
                    requestId()
                    timeZone()
                },
            required = listOf("mode", "start", "minutes"),
            readOnly = false,
        ),
        ToolDefinition(
            name = FILE_CYCLE,
            description =
                "Files an Inbox cycle to a node. list_nodes shows the Inbox cycle IDs. " +
                    "A cycle is filed once.",
            properties =
                properties {
                    string("cycle_id", "The Inbox cycle's cycle_id.")
                    node()
                    timeZone()
                },
            required = listOf("cycle_id"),
            readOnly = false,
        ),
        ToolDefinition(
            name = SET_ESTIMATE,
            description =
                "Sets a node's estimate for one mode, as a number of cycles. " +
                    "The other modes keep their estimates. 0 cycles clears the mode.",
            properties =
                properties {
                    node()
                    mode()
                    integer("cycles", "The number of cycles.")
                    integer(
                        "cycle_minutes",
                        "The length of one cycle. Default: the current estimate, else the user's setting.",
                    )
                },
            required = listOf("mode", "cycles"),
            readOnly = false,
        ),
    )

private fun properties(block: JsonObjectBuilder.() -> Unit) = buildJsonObject(block)

private fun JsonObjectBuilder.property(name: String, type: String, description: String) =
    putJsonObject(name) {
        put("type", type)
        put("description", description)
    }

private fun JsonObjectBuilder.string(name: String, description: String) =
    property(name, "string", description)

private fun JsonObjectBuilder.integer(name: String, description: String) =
    property(name, "integer", description)

private fun JsonObjectBuilder.boolean(name: String, description: String) =
    property(name, "boolean", description)

private fun JsonObjectBuilder.node() {
    string(
        "node_path",
        "The node's path, for example \"Book / Chapter 1\". A name alone also works. " +
            "Write a \"/\" inside a name as \"//\".",
    )
    string("node_id", "Instead of node_path: the node_id.")
}

private fun JsonObjectBuilder.mode() =
    putJsonObject("mode") {
        put("type", "string")
        putJsonArray("enum") { FocusMode.entries.forEach { add(it.argument) } }
        put("description", "The work mode.")
    }

private fun JsonObjectBuilder.requestId() =
    string(
        "request_id",
        "Optional. Send the same value on a retry, and the call creates nothing twice.",
    )

private fun JsonObjectBuilder.timeZone() =
    string("time_zone", "An IANA zone such as Asia/Kolkata, for times in and out. Default UTC.")
