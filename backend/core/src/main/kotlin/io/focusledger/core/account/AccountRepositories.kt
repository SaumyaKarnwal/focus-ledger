package io.focusledger.core.account

import io.focusledger.core.UserId

interface AccountRepository {
    /**
     * The account for [email], created when none exists. The lookup ignores case. A new account
     * gets its settings row with the schema defaults in the same transaction. This is the one
     * function that takes no [UserId], because sign-in is how the caller gets one.
     */
    fun findOrCreateByEmail(email: String): Account

    fun find(userId: UserId): Account?
}

interface SettingsRepository {
    /** The user's settings, or null when the user has no account. */
    fun find(userId: UserId): Settings?

    /** Changes the fields in the update mask, and returns the settings, or null with no account. */
    fun update(userId: UserId, update: SettingsUpdate): Settings?
}
