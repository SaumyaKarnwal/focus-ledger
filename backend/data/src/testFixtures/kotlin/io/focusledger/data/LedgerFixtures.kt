package io.focusledger.data

import java.sql.Connection
import java.time.OffsetDateTime
import java.util.UUID

/** Inserts test rows through [connection], which is normally focusledger_app. */
class LedgerFixtures(private val connection: Connection) {

    fun newUser(email: String = "user-${UUID.randomUUID()}@example.com"): UUID =
        UUID.fromString(
            connection.queryString(
                "INSERT INTO account.app_user (email) VALUES (?) RETURNING id",
                email,
            )
        )

    fun newNode(userId: UUID, parentId: UUID? = null, requestId: UUID = UUID.randomUUID()): UUID =
        UUID.fromString(
            connection.queryString(
                "INSERT INTO ledger.node (user_id, request_id, parent_id, name) VALUES (?, ?, ?, 'Node') RETURNING id",
                userId,
                requestId,
                parentId,
            )
        )

    /** A running cycle (minutes NULL) when [minutes] is null, or a logged one. */
    fun newCycle(
        userId: UUID,
        nodeId: UUID? = null,
        minutes: Int? = null,
        plannedMinutes: Int = 50,
        requestId: UUID = UUID.randomUUID(),
    ): UUID =
        UUID.fromString(
            connection.queryString(
                """
                INSERT INTO ledger.cycle (user_id, request_id, node_id, mode, started_at, planned_minutes, minutes)
                VALUES (?, ?, ?, 'deep_focus', ?, ?, ?) RETURNING id
                """,
                userId,
                requestId,
                nodeId,
                OffsetDateTime.parse("2026-09-25T02:00:00Z"),
                plannedMinutes,
                minutes,
            )
        )
}
