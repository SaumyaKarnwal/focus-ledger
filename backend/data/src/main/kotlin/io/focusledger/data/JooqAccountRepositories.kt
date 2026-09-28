package io.focusledger.data

import io.focusledger.core.UserId
import io.focusledger.core.account.Account
import io.focusledger.core.account.AccountRepository
import io.focusledger.core.account.Settings
import io.focusledger.core.account.SettingsField
import io.focusledger.core.account.SettingsRepository
import io.focusledger.core.account.SettingsUpdate
import io.focusledger.data.jooq.account.Tables.APP_USER
import io.focusledger.data.jooq.account.Tables.USER_SETTINGS
import io.focusledger.data.jooq.account.tables.records.AppUserRecord
import io.focusledger.data.jooq.account.tables.records.UserSettingsRecord
import org.jooq.Condition
import org.jooq.impl.DSL

class JooqAccountRepository(private val database: LedgerDatabase) : AccountRepository {

    override fun findOrCreateByEmail(email: String): Account = database.transaction { dsl ->
        val created =
            dsl.insertInto(APP_USER)
                .set(APP_USER.EMAIL, email)
                .onConflict(APP_USER.EMAIL)
                .doNothing()
                .returning()
                .fetchOne()
        if (created != null) {
            dsl.insertInto(USER_SETTINGS).set(USER_SETTINGS.USER_ID, created.id).execute()
            created.toCore()
        } else {
            dsl.selectFrom(APP_USER).where(emailIs(email)).fetchSingle().toCore()
        }
    }

    override fun find(userId: UserId): Account? =
        database.dsl().selectFrom(APP_USER).where(APP_USER.ID.eq(userId.value)).fetchOne()?.toCore()

    companion object {
        /**
         * The generated column type is String, so a plain `eq` binds varchar and compares as text,
         * which is case-sensitive and skips the unique index. Binding citext keeps both.
         */
        internal fun emailIs(email: String): Condition =
            APP_USER.EMAIL.eq(
                DSL.field("cast({0} as public.citext)", String::class.java, DSL.`val`(email))
            )
    }
}

class JooqSettingsRepository(private val database: LedgerDatabase) : SettingsRepository {

    override fun find(userId: UserId): Settings? =
        database
            .dsl()
            .selectFrom(USER_SETTINGS)
            .where(USER_SETTINGS.USER_ID.eq(userId.value))
            .fetchOne()
            ?.toCore()

    override fun update(userId: UserId, update: SettingsUpdate): Settings? {
        val values = update.settings
        val changes =
            update.mask.associate { field ->
                when (field) {
                    SettingsField.DEEP_FOCUS_MINUTES ->
                        USER_SETTINGS.DEEP_FOCUS_MINUTES to values.deepFocusMinutes
                    SettingsField.EXECUTION_MINUTES ->
                        USER_SETTINGS.EXECUTION_MINUTES to values.executionMinutes
                    SettingsField.SHALLOW_MINUTES ->
                        USER_SETTINGS.SHALLOW_MINUTES to values.shallowMinutes
                    SettingsField.BREAK_MINUTES ->
                        USER_SETTINGS.BREAK_MINUTES to values.breakMinutes
                    SettingsField.SOUND_ENABLED ->
                        USER_SETTINGS.SOUND_ENABLED to values.soundEnabled
                    SettingsField.NOTIFICATIONS_ENABLED ->
                        USER_SETTINGS.NOTIFICATIONS_ENABLED to values.notificationsEnabled
                }
            }
        return database
            .dsl()
            .update(USER_SETTINGS)
            .set(changes)
            .where(USER_SETTINGS.USER_ID.eq(userId.value))
            .returning()
            .fetchOne()
            ?.toCore()
    }
}

private fun AppUserRecord.toCore(): Account = Account(UserId(id), email, createdAt)

private fun UserSettingsRecord.toCore(): Settings =
    Settings(
        deepFocusMinutes = deepFocusMinutes,
        executionMinutes = executionMinutes,
        shallowMinutes = shallowMinutes,
        breakMinutes = breakMinutes,
        soundEnabled = soundEnabled,
        notificationsEnabled = notificationsEnabled,
    )
