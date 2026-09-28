package io.focusledger.core.account

import io.focusledger.core.ServiceResult
import io.focusledger.core.UserId

/** Sign-in and settings. The adapter sets and clears the session cookie. */
interface AccountService {
    /**
     * Checks [credential], rejects an unverified email, and finds or creates the account by email.
     * The caller starts the session for the returned account.
     */
    fun signIn(credential: SignInCredential): ServiceResult<Account>

    fun getAccount(userId: UserId): ServiceResult<Account>

    fun getSettings(userId: UserId): ServiceResult<Settings>

    fun updateSettings(userId: UserId, update: SettingsUpdate): ServiceResult<Settings>
}

/**
 * Checks a credential with its provider (signature, audience, issuer, expiry). An adapter module
 * implements it, because the check needs the provider's library.
 */
fun interface IdentityVerifier {
    /** The identity, or null when the credential fails a check. */
    fun verify(credential: SignInCredential): VerifiedIdentity?
}
