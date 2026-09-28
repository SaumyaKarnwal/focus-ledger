package io.focusledger.core.account

import io.focusledger.core.Limits
import io.focusledger.core.ServiceError
import io.focusledger.core.ServiceResult
import io.focusledger.core.UserId
import io.focusledger.core.checkRange
import io.focusledger.core.invalid

class CoreAccountService(
    private val verifier: IdentityVerifier,
    private val accounts: AccountRepository,
    private val settings: SettingsRepository,
) : AccountService {

    override fun signIn(credential: SignInCredential): ServiceResult<Account> {
        val identity = verifier.verify(credential)
        if (identity == null || !identity.emailVerified || identity.email.isBlank()) {
            return UNAUTHENTICATED
        }
        return ServiceResult.Success(accounts.findOrCreateByEmail(identity.email))
    }

    override fun getAccount(userId: UserId): ServiceResult<Account> =
        accounts.find(userId)?.let { ServiceResult.Success(it) } ?: UNAUTHENTICATED

    override fun getSettings(userId: UserId): ServiceResult<Settings> =
        settings.find(userId)?.let { ServiceResult.Success(it) } ?: UNAUTHENTICATED

    override fun updateSettings(userId: UserId, update: SettingsUpdate): ServiceResult<Settings> {
        if (update.mask.isEmpty()) return invalid("update_mask", "must name at least one field")
        val values = update.settings
        val failure =
            update.mask.firstNotNullOfOrNull { field ->
                when (field) {
                    SettingsField.DEEP_FOCUS_MINUTES ->
                        checkRange(
                            "deep_focus_minutes",
                            values.deepFocusMinutes,
                            Limits.MODE_MINUTES,
                        )
                    SettingsField.EXECUTION_MINUTES ->
                        checkRange(
                            "execution_minutes",
                            values.executionMinutes,
                            Limits.MODE_MINUTES,
                        )
                    SettingsField.SHALLOW_MINUTES ->
                        checkRange("shallow_minutes", values.shallowMinutes, Limits.MODE_MINUTES)
                    SettingsField.BREAK_MINUTES ->
                        checkRange("break_minutes", values.breakMinutes, Limits.BREAK_MINUTES)
                    SettingsField.SOUND_ENABLED,
                    SettingsField.NOTIFICATIONS_ENABLED -> null
                }
            }
        return failure
            ?: settings.update(userId, update)?.let { ServiceResult.Success(it) }
            ?: UNAUTHENTICATED
    }

    private companion object {
        val UNAUTHENTICATED = ServiceResult.Failure(ServiceError.Unauthenticated)
    }
}
