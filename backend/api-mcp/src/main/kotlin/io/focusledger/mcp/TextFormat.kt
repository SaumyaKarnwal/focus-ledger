package io.focusledger.mcp

import io.focusledger.core.ledger.FocusMode
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/** "1h 30m", "45m", "2h", or "0". */
internal fun formatMinutes(minutes: Int): String {
    val hours = minutes / 60
    val rest = minutes % 60
    return when {
        minutes == 0 -> "0"
        hours == 0 -> "${rest}m"
        rest == 0 -> "${hours}h"
        else -> "${hours}h ${rest}m"
    }
}

internal val FocusMode.label: String
    get() =
        when (this) {
            FocusMode.DEEP_FOCUS -> "Deep Focus"
            FocusMode.EXECUTION -> "Execution"
            FocusMode.SHALLOW -> "Shallow"
        }

/** The value that a tool argument uses for the mode. */
internal val FocusMode.argument: String
    get() = name.lowercase()

/**
 * A node name or path as a quoted string literal. Node names are user text, so the tools never
 * print one bare: an agent then reads it as data, and a newline in a name cannot start a new line
 * of the output.
 */
internal fun quoted(userText: String): String = buildString {
    append('"')
    userText.forEach { character ->
        when {
            character == '"' -> append("\\\"")
            character == '\\' -> append("\\\\")
            character == '\n' -> append("\\n")
            character == '\r' -> append("\\r")
            character == '\t' -> append("\\t")
            character.isISOControl() || character in LINE_BREAKS ->
                append("\\u%04x".format(character.code))
            else -> append(character)
        }
    }
    append('"')
}

/** The line and paragraph separators, which break a line but are not ISO control characters. */
private val LINE_BREAKS = setOf(' ', ' ')

private val localDateTime = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")

/** The instant as a wall-clock time in [zone], for example "2026-11-01 14:30". */
internal fun formatLocal(instant: Instant, zone: ZoneId): String =
    localDateTime.format(instant.atZone(zone))
