package io.focusledger.core.account

import io.focusledger.core.UserId

interface AccountRepository {
    /**
     * The account for [email], created when none exists. The lookup ignores case. This is the one
     * function that takes no [UserId], because sign-in is how the caller gets one.
     */
    fun findOrCreateByEmail(email: String): Account

    fun find(userId: UserId): Account?
}

interface SettingsRepository {
    /** The user's settings, or null when the user has no settings row. */
    fun find(userId: UserId): Settings?

    /**
     * Changes the fields that [update] holds, and returns the settings. When the user has no
     * settings row, it first creates one with the schema defaults.
     */
    fun update(userId: UserId, update: SettingsUpdate): Settings
}
