package io.focusledger.core

import java.util.UUID

/** The signed-in user. It comes from the session or the token, never from a request field. */
@JvmInline value class UserId(val value: UUID)

@JvmInline value class NodeId(val value: UUID)

@JvmInline value class CycleId(val value: UUID)

/** The client's idempotency key for one create action. */
@JvmInline value class RequestId(val value: UUID)
