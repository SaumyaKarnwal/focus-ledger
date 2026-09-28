package io.focusledger.mcp.oauth

import io.focusledger.core.UserId
import io.focusledger.core.account.AgentConnection
import io.focusledger.core.account.AgentConnectionRepository
import io.focusledger.mcp.TestClock
import java.net.URI
import java.net.URLDecoder
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Instant
import java.util.Base64
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.RepeatedTest
import org.junit.jupiter.api.Test

/** Two redemptions of one login code at the same time. */
class OAuthCodeRaceTest {
    private val user = UserId(UUID.randomUUID())
    private val clock = TestClock(Instant.parse("2026-11-01T20:00:00Z"))
    private val config =
        OAuthConfig("http://localhost", ByteArray(32).also(SecureRandom()::nextBytes))
    private val clientId = "https://agent.example/client.json"
    private val redirectUri = "http://localhost:33418/callback"
    private val clients = ClientMetadataSource {
        ClientLookup.Found(ClientMetadata(clientId, "Example Agent", listOf(redirectUri)))
    }
    private val verifier = "v".repeat(50)
    private val challenge =
        Base64.getUrlEncoder()
            .withoutPadding()
            .encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray()))

    private val stored = InMemoryAgentConnections(clock)

    /** Lets a test hold the first redemption inside its insert. */
    private var beforeInsert: () -> Unit = {}
    private val connections =
        object : AgentConnectionRepository by stored {
            override fun insert(
                userId: UserId,
                clientId: String,
                refreshSecretHash: ByteArray,
            ): AgentConnection {
                beforeInsert()
                return stored.insert(userId, clientId, refreshSecretHash)
            }
        }
    private val oauth = OAuthServer(config, connections, clients, { null }, clock)

    private fun loginCode(): String {
        val check =
            oauth.checkAuthorization(
                mapOf(
                    "response_type" to "code",
                    "client_id" to clientId,
                    "redirect_uri" to redirectUri,
                    "code_challenge" to challenge,
                    "code_challenge_method" to "S256",
                )
            ) as AuthorizationCheck.Valid
        val redirect =
            oauth.decide(user, oauth.consentToken(user, check.request), approved = true)
                as AuthorizationCheck.Redirect
        return URI(redirect.url)
            .rawQuery
            .split('&')
            .first { it.startsWith("code=") }
            .removePrefix("code=")
            .let { URLDecoder.decode(it, Charsets.UTF_8) }
    }

    private fun redeem(code: String) =
        oauth.token(
            mapOf(
                "grant_type" to "authorization_code",
                "code" to code,
                "redirect_uri" to redirectUri,
                "client_id" to clientId,
                "code_verifier" to verifier,
            )
        )

    private fun refresh(refreshToken: String) =
        oauth.token(
            mapOf(
                "grant_type" to "refresh_token",
                "refresh_token" to refreshToken,
                "client_id" to clientId,
            )
        )

    @Test
    fun reuseWhileTheFirstRedemptionInserts_issuesNoTokenAndRevokesTheConnection() {
        val code = loginCode()
        val firstIsInserting = CountDownLatch(1)
        val secondIsDone = CountDownLatch(1)
        beforeInsert = {
            firstIsInserting.countDown()
            secondIsDone.await(5, TimeUnit.SECONDS)
        }
        val executor = Executors.newSingleThreadExecutor()
        try {
            val first = executor.submit<TokenResult> { redeem(code) }
            firstIsInserting.await(5, TimeUnit.SECONDS)

            val second = redeem(code)
            secondIsDone.countDown()

            assertEquals(TokenResult.Failed("invalid_grant", "The code was already used."), second)
            assertEquals(
                TokenResult.Failed("invalid_grant", "The code was already used."),
                first.get(5, TimeUnit.SECONDS),
            )
            assertTrue(stored.all().single().revokedAt != null)
        } finally {
            executor.shutdownNow()
        }
    }

    @RepeatedTest(20)
    fun parallelRedemptions_leaveNoWorkingRefreshToken() {
        val code = loginCode()
        val start = CountDownLatch(1)
        val executor = Executors.newFixedThreadPool(PARALLEL)
        try {
            val results =
                (1..PARALLEL)
                    .map {
                        executor.submit<TokenResult> {
                            start.await()
                            redeem(code)
                        }
                    }
                    .also { start.countDown() }
                    .map { it.get(5, TimeUnit.SECONDS) }
            val issued = results.filterIsInstance<TokenResult.Issued>()

            assertTrue(issued.size <= 1, "More than one redemption got tokens: $results")
            assertTrue(stored.all().all { it.revokedAt != null }, "A connection stayed active")
            issued.forEach { tokens ->
                val refreshToken = tokens.body.getValue("refresh_token").jsonPrimitive.content
                assertTrue(refresh(refreshToken) is TokenResult.Failed)
            }
        } finally {
            executor.shutdownNow()
        }
    }

    private companion object {
        const val PARALLEL = 8
    }
}
