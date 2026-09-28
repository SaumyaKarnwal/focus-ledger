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

/** The fields of one settings update. A null field is not in the update mask. */
data class SettingsUpdate(
    val deepFocusMinutes: Int? = null,
    val executionMinutes: Int? = null,
    val shallowMinutes: Int? = null,
    val breakMinutes: Int? = null,
    val soundEnabled: Boolean? = null,
    val notificationsEnabled: Boolean? = null,
)

/** A sign-in credential. A new provider adds a subtype. */
sealed interface SignInCredential {
    data class GoogleIdToken(val token: String) : SignInCredential
}

/** What a provider says about a checked credential. */
data class VerifiedIdentity(val email: String, val emailVerified: Boolean)
