package io.focusledger.data

import io.focusledger.core.ServiceError
import io.focusledger.core.UserId
import io.focusledger.core.account.Settings
import io.focusledger.core.account.SettingsField
import io.focusledger.core.account.SettingsUpdate
import io.focusledger.core.account.SignInCredential
import io.focusledger.data.TestDatabase.APP
import java.util.UUID
import org.jooq.impl.DSL
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class AccountServiceTest {
    private val services = TestServices()
    private val account = services.account

    @Test
    fun signIn_newEmail_createsAccountWithDefaultSettings() {
        val email = "${UUID.randomUUID()}@example.com"

        val created = account.signIn(SignInCredential.GoogleIdToken(email)).value()

        assertEquals(email, created.email)
        assertEquals(DEFAULT_SETTINGS, account.getSettings(created.id).value())
    }

    @Test
    fun signIn_sameEmailInOtherCase_findsTheStoredAccount() {
        val stored = "${UUID.randomUUID()}@example.com"
        val first = account.signIn(SignInCredential.GoogleIdToken(stored)).value()

        val again = account.signIn(SignInCredential.GoogleIdToken(stored.uppercase())).value()

        assertEquals(first, again)
    }

    @Test
    fun signIn_unverifiedEmail_isUnauthenticated() {
        val result =
            account.signIn(
                SignInCredential.GoogleIdToken("unverified:${UUID.randomUUID()}@example.com")
            )

        assertFailure(ServiceError.Unauthenticated, result)
    }

    @Test
    fun signIn_failedCredential_isUnauthenticated() {
        assertFailure(
            ServiceError.Unauthenticated,
            account.signIn(SignInCredential.GoogleIdToken("invalid")),
        )
    }

    /** #26: A@Example.com finds a@example.com, and the query can use the unique index. */
    @Test
    fun emailLookup_bindsCitext_ignoresCaseAndUsesUniqueIndex() {
        val stored = "a-${UUID.randomUUID()}@example.com"
        services.accounts.findOrCreateByEmail(stored)
        val lookup = stored.replaceFirst("a-", "A-").replace("example.com", "Example.com")

        TestDatabase.connectAs(APP).use { connection ->
            connection.autoCommit = false
            connection.execute("SET LOCAL enable_seqscan = off")
            val dsl = DSL.using(connection, org.jooq.SQLDialect.POSTGRES)
            val query =
                dsl.selectFrom(io.focusledger.data.jooq.account.Tables.APP_USER)
                    .where(JooqAccountRepository.emailIs(lookup))
            val plan =
                dsl.fetch("EXPLAIN " + query.getSQL(org.jooq.conf.ParamType.INLINED)).map {
                    it.get(0).toString()
                }

            assertEquals(stored, query.fetchSingle().email)
            assertTrue(plan.any { "app_user_email_key" in it }, plan.joinToString("\n"))
            connection.rollback()
        }
    }

    @Test
    fun getAccount_unknownUser_isUnauthenticated() {
        assertFailure(ServiceError.Unauthenticated, account.getAccount(UserId(UUID.randomUUID())))
    }

    @Test
    fun updateSettings_changesOnlyMaskedFields() {
        val userId = services.newUser()

        val updated =
            account
                .updateSettings(
                    userId,
                    SettingsUpdate(
                        setOf(SettingsField.BREAK_MINUTES, SettingsField.SOUND_ENABLED),
                        DEFAULT_SETTINGS.copy(
                            breakMinutes = 10,
                            soundEnabled = false,
                            shallowMinutes = 5,
                        ),
                    ),
                )
                .value()

        assertEquals(DEFAULT_SETTINGS.copy(breakMinutes = 10, soundEnabled = false), updated)
    }

    @Test
    fun updateSettings_emptyMask_isInvalid() {
        val result =
            account.updateSettings(services.newUser(), SettingsUpdate(emptySet(), DEFAULT_SETTINGS))

        assertFailure(
            ServiceError.InvalidArgument("update_mask", "must name at least one field"),
            result,
        )
    }

    @Test
    fun updateSettings_breakOutOfRange_isInvalid() {
        val result =
            account.updateSettings(
                services.newUser(),
                SettingsUpdate(
                    setOf(SettingsField.BREAK_MINUTES),
                    DEFAULT_SETTINGS.copy(breakMinutes = 61),
                ),
            )

        assertFailure(ServiceError.InvalidArgument("break_minutes", "must be from 1 to 60"), result)
    }

    @Test
    fun updateSettings_unknownUser_isUnauthenticated() {
        val result =
            account.updateSettings(
                UserId(UUID.randomUUID()),
                SettingsUpdate(setOf(SettingsField.SOUND_ENABLED), DEFAULT_SETTINGS),
            )

        assertFailure(ServiceError.Unauthenticated, result)
    }

    private companion object {
        val DEFAULT_SETTINGS =
            Settings(90, 50, 25, 5, soundEnabled = true, notificationsEnabled = false)
    }
}
