package io.focusledger.mcp

import io.focusledger.core.RequestId
import io.focusledger.core.ledger.FocusMode
import java.time.DateTimeException
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeParseException
import java.util.UUID
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.intOrNull

/** A tool input that the agent must fix. The message tells the agent what to send instead. */
internal class ToolInputException(message: String) : Exception(message)

/** The arguments of one tool call. Each getter rejects a value of the wrong JSON type. */
internal class ToolArguments(private val arguments: JsonObject) {
    fun string(name: String): String? =
        when (val value = arguments[name]) {
            null,
            JsonNull -> null
            is JsonPrimitive if value.isString -> value.content.trim().ifEmpty { null }
            else -> throw ToolInputException("$name must be a string.")
        }

    fun requiredString(name: String): String =
        string(name) ?: throw ToolInputException("$name is required.")

    fun int(name: String): Int? =
        when (val value = arguments[name]) {
            null,
            JsonNull -> null
            is JsonPrimitive if !value.isString && value.intOrNull != null -> value.intOrNull
            else -> throw ToolInputException("$name must be a whole number.")
        }

    fun requiredInt(name: String): Int = int(name) ?: throw ToolInputException("$name is required.")

    fun boolean(name: String): Boolean? =
        when (val value = arguments[name]) {
            null,
            JsonNull -> null
            is JsonPrimitive if !value.isString && value.booleanOrNull != null ->
                value.booleanOrNull
            else -> throw ToolInputException("$name must be true or false.")
        }

    fun mode(name: String = "mode"): FocusMode {
        val text = requiredString(name)
        val normalized = text.lowercase().replace(' ', '_').replace('-', '_')
        return FocusMode.entries.firstOrNull { it.argument == normalized }
            ?: throw ToolInputException(
                "Unknown $name ${quoted(text)}. Use one of: " +
                    FocusMode.entries.joinToString { it.argument } +
                    "."
            )
    }

    /** The IANA zone in `time_zone`, or UTC when the call has none. */
    fun timeZone(): ZoneId {
        val text = string(TIME_ZONE) ?: return UTC
        return try {
            ZoneId.of(text)
        } catch (_: DateTimeException) {
            throw ToolInputException(
                "Unknown time_zone ${quoted(text)}. Use an IANA name such as Asia/Kolkata."
            )
        }
    }

    /**
     * A time with an offset (`2026-11-01T15:00:00Z`, `2026-11-01T15:00+05:30`) as given. A time
     * with no offset (`2026-11-01T15:00`) or a date (`2026-11-01`, meaning its midnight) is read in
     * [zone].
     */
    fun instant(name: String, zone: ZoneId): Instant? {
        val text = string(name) ?: return null
        return parseInstant(text, zone)
            ?: throw ToolInputException(
                "$name ${quoted(text)} is not a time. Use ISO 8601, for example " +
                    "2026-11-01T15:00 (read in time_zone) or 2026-11-01T15:00:00Z."
            )
    }

    /**
     * The agent's `request_id`, or a new one for this call. A UUID is used as it is. Any other text
     * becomes a name-based UUID of the tool and the text, so a retry with the same text still
     * creates nothing twice.
     */
    fun requestId(toolName: String, newRequestId: () -> UUID): RequestId {
        val text = string(REQUEST_ID) ?: return RequestId(newRequestId())
        val uuid =
            try {
                UUID.fromString(text)
            } catch (_: IllegalArgumentException) {
                UUID.nameUUIDFromBytes("$toolName:$text".toByteArray())
            }
        return RequestId(uuid)
    }

    private fun parseInstant(text: String, zone: ZoneId): Instant? =
        listOf(
                { OffsetDateTime.parse(text).toInstant() },
                { LocalDateTime.parse(text).atZone(zone).toInstant() },
                { LocalDate.parse(text).atStartOfDay(zone).toInstant() },
            )
            .firstNotNullOfOrNull { parse ->
                try {
                    parse()
                } catch (_: DateTimeParseException) {
                    null
                }
            }

    companion object {
        const val TIME_ZONE = "time_zone"
        const val REQUEST_ID = "request_id"
        val UTC: ZoneId = ZoneId.of("UTC")
    }
}
