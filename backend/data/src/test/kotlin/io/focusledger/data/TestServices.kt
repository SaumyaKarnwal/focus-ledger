package io.focusledger.data

import io.focusledger.core.RequestId
import io.focusledger.core.ServiceResult
import io.focusledger.core.UserId
import io.focusledger.core.account.CoreAccountService
import io.focusledger.core.account.IdentityVerifier
import io.focusledger.core.account.SignInCredential
import io.focusledger.core.account.VerifiedIdentity
import io.focusledger.core.ledger.CoreLedgerService
import io.focusledger.core.ledger.CreateNode
import io.focusledger.core.ledger.Node
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.fail

/** A clock that a test moves by hand. */
class TestClock(var now: Instant = Instant.parse("2026-09-28T09:00:00Z")) : Clock() {
    override fun instant(): Instant = now

    override fun getZone() = ZoneOffset.UTC

    override fun withZone(zone: java.time.ZoneId) = this
}

/**
 * The real services on the jOOQ repositories, as focusledger_app. A verified identity is the token
 * text itself, so a test signs in by email.
 */
class TestServices(val clock: TestClock = TestClock()) {
    val nodes = JooqNodeRepository(TestDatabase.app)
    val cycles = JooqCycleRepository(TestDatabase.app)
    val accounts = JooqAccountRepository(TestDatabase.app)
    val settings = JooqSettingsRepository(TestDatabase.app)
    val transactor = JooqTransactor(TestDatabase.app)

    val ledger = CoreLedgerService(nodes, cycles, transactor, clock)

    val account =
        CoreAccountService(
            verifier =
                IdentityVerifier { credential ->
                    val token = (credential as SignInCredential.GoogleIdToken).token
                    when {
                        token.startsWith("unverified:") ->
                            VerifiedIdentity(token.removePrefix("unverified:"), false)
                        token.startsWith("invalid") -> null
                        else -> VerifiedIdentity(token, true)
                    }
                },
            accounts = accounts,
            settings = settings,
        )

    fun newUser(): UserId =
        account
            .signIn(SignInCredential.GoogleIdToken("user-${UUID.randomUUID()}@example.com"))
            .value()
            .id

    fun newNode(userId: UserId, name: String = "Node", parent: Node? = null): Node =
        ledger
            .createNode(
                userId,
                CreateNode(RequestId(UUID.randomUUID()), parent?.id, name, emptyList()),
            )
            .value()
}

fun <T> ServiceResult<T>.value(): T =
    when (this) {
        is ServiceResult.Success -> value
        is ServiceResult.Failure -> fail("Expected success, got $error")
    }

fun assertFailure(expected: io.focusledger.core.ServiceError, actual: ServiceResult<*>) {
    assertEquals(ServiceResult.Failure(expected), actual)
}
