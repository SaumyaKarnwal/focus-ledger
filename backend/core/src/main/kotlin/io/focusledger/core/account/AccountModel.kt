package io.focusledger.core.account

import io.focusledger.core.UserId
import java.time.Instant

data class Account(val id: UserId, val email: String, val createdAt: Instant)

data class Settings(
    val deepFocusMinutes: Int,
    val executionMinutes: Int,
    val shallowMinutes: Int,
    val breakMinutes: Int,
    val soundEnabled: Boolean,
    val notificationsEnabled: Boolean,
)

enum class SettingsField {
    DEEP_FOCUS_MINUTES,
    EXECUTION_MINUTES,
    SHALLOW_MINUTES,
    BREAK_MINUTES,
    SOUND_ENABLED,
    NOTIFICATIONS_ENABLED,
}

/**
 * One settings update: the fields in [mask] change to their values in [settings], and the service
 * ignores the other values. An empty mask returns
 * [io.focusledger.core.ServiceError.InvalidArgument].
 */
data class SettingsUpdate(val mask: Set<SettingsField>, val settings: Settings)

/** A sign-in credential. A new provider adds a subtype. */
sealed interface SignInCredential {
    data class GoogleIdToken(val token: String) : SignInCredential
}

/** What a provider says about a checked credential. */
data class VerifiedIdentity(val email: String, val emailVerified: Boolean)
