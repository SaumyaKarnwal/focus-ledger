package io.focusledger.grpc

import com.linecorp.armeria.client.WebClient
import com.linecorp.armeria.common.HttpData
import com.linecorp.armeria.common.HttpMethod
import com.linecorp.armeria.common.MediaType
import com.linecorp.armeria.common.RequestHeaders
import focusledger.v1.LedgerServiceOuterClass.GetAccountRequest
import focusledger.v1.LedgerServiceOuterClass.ListNodesRequest
import focusledger.v1.LedgerServiceOuterClass.SignInRequest
import focusledger.v1.LedgerServiceOuterClass.SignOutRequest
import io.grpc.Status
import io.grpc.StatusRuntimeException
import java.time.Duration
import java.util.UUID
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

class SignInAndSessionTest {
    private val server = GrpcTestServer()

    @AfterEach
    fun stop() {
        server.stop()
    }

    @Test
    fun signIn_verifiedEmail_setsSessionCookieAndReturnsAccount() {
        val browser = server.browser()
        val email = "${UUID.randomUUID()}@example.com"

        val response = browser.stub.signIn(signIn(server.idToken(email)))

        assertEquals(email, response.account.email)
        val setCookie = browser.setCookies.single()
        listOf("session=", "Max-Age=2592000", "Path=/", "HttpOnly", "Secure", "SameSite=Lax")
            .forEach {
                assertTrue(setCookie.contains(it), "$it missing from $setCookie")
            }
        assertEquals(
            email,
            browser.stub.getAccount(GetAccountRequest.getDefaultInstance()).account.email,
        )
    }

    @Test
    fun signIn_sameEmailInOtherCase_reachesTheSameAccount() {
        val email = "${UUID.randomUUID()}@example.com"
        val first = server.signedIn(email)

        val second = server.signedIn(email.uppercase())

        assertEquals(accountId(first), accountId(second))
    }

    @Test
    fun signIn_unverifiedEmail_isUnauthenticatedAndSetsNoCookie() {
        assertSignInRejected(server.idToken("${UUID.randomUUID()}@example.com", verified = false))
    }

    @Test
    fun signIn_expiredToken_isUnauthenticated() {
        assertSignInRejected(
            server.idToken("${UUID.randomUUID()}@example.com", expiresIn = Duration.ofMinutes(-5))
        )
    }

    @Test
    fun signIn_tokenForAnotherClientId_isUnauthenticated() {
        assertSignInRejected(
            server.idToken(
                "${UUID.randomUUID()}@example.com",
                audience = "other-client.apps.googleusercontent.com",
            )
        )
    }

    @Test
    fun signIn_tokenFromAnotherIssuer_isUnauthenticated() {
        assertSignInRejected(
            server.idToken("${UUID.randomUUID()}@example.com", issuer = "https://evil.example.com")
        )
    }

    @Test
    fun signIn_tokenSignedByAnotherKey_isUnauthenticated() {
        assertSignInRejected(
            server.idToken("${UUID.randomUUID()}@example.com", key = GrpcTestServer.OTHER_KEY)
        )
    }

    @Test
    fun signIn_noCredential_isInvalidArgument() {
        val error =
            assertThrows<StatusRuntimeException> {
                server.browser().stub.signIn(SignInRequest.getDefaultInstance())
            }

        assertEquals(Status.Code.INVALID_ARGUMENT, error.status.code)
    }

    @Test
    fun signOut_clearsTheCookieAndTheNextCallIsUnauthenticated() {
        val browser = server.signedIn()
        assertTrue(browser.cookie != null)

        browser.stub.signOut(SignOutRequest.getDefaultInstance())

        assertTrue(browser.setCookies.last().startsWith("session=; Max-Age=0"))
        assertNull(browser.cookie)
        assertUnauthenticated { browser.stub.getAccount(GetAccountRequest.getDefaultInstance()) }
    }

    @Test
    fun signOut_withNoSession_succeeds() {
        server.browser().stub.signOut(SignOutRequest.getDefaultInstance())
    }

    @Test
    fun session_tamperedCookie_isUnauthenticated() {
        val browser = server.signedIn()
        val value = browser.cookie!!.removePrefix("session=")
        browser.cookie = "session=" + value.dropLast(2) + if (value.endsWith("AA")) "BB" else "AA"

        assertUnauthenticated { browser.stub.getAccount(GetAccountRequest.getDefaultInstance()) }
    }

    @Test
    fun session_after30Days_isUnauthenticated() {
        val browser = server.signedIn()
        server.clock.now = server.clock.now.plus(Duration.ofDays(30))

        assertUnauthenticated { browser.stub.getAccount(GetAccountRequest.getDefaultInstance()) }
    }

    @Test
    fun session_withinOneDay_isNotRenewed() {
        val browser = server.signedIn()
        server.clock.now = server.clock.now.plus(Duration.ofHours(23))

        browser.stub.listNodes(ListNodesRequest.getDefaultInstance())

        assertEquals(1, browser.setCookies.size)
    }

    @Test
    fun session_olderThanOneDay_isRenewedFor30Days() {
        val browser = server.signedIn()
        val firstCookie = browser.cookie
        server.clock.now = server.clock.now.plus(Duration.ofDays(29))

        browser.stub.listNodes(ListNodesRequest.getDefaultInstance())
        server.clock.now = server.clock.now.plus(Duration.ofDays(2))

        assertEquals(2, browser.setCookies.size)
        assertTrue(firstCookie != browser.cookie)
        assertEquals(
            accountId(browser),
            browser.stub.getAccount(GetAccountRequest.getDefaultInstance()).account.id,
        )
    }

    /**
     * Spike check 1 (#31): a browser-shaped gRPC-Web request, as Connect's gRPC-Web transport sends
     * it, reaches Armeria and gets a gRPC-Web answer.
     */
    @Test
    fun grpcWeb_browserShapedRequest_reachesArmeria() {
        val emptyMessageFrame = HttpData.wrap(byteArrayOf(0, 0, 0, 0, 0))
        val headers =
            RequestHeaders.builder(HttpMethod.POST, "/focusledger.v1.LedgerService/GetAccount")
                .contentType(MediaType.parse("application/grpc-web+proto"))
                .add("x-grpc-web", "1")
                .add("origin", server.baseUrl)
                .build()

        val response =
            WebClient.of(server.baseUrl).execute(headers, emptyMessageFrame).aggregate().join()

        assertEquals(200, response.status().code())
        assertEquals("application/grpc-web+proto", response.headers().contentType()?.toString())
        assertEquals("16", response.headers().get("grpc-status"))
    }

    private fun assertSignInRejected(token: String) {
        val browser = server.browser()

        assertUnauthenticated { browser.stub.signIn(signIn(token)) }
        assertEquals(emptyList<String>(), browser.setCookies)
    }

    private fun signIn(token: String) = SignInRequest.newBuilder().setGoogleIdToken(token).build()

    private fun accountId(browser: Browser) =
        browser.stub.getAccount(GetAccountRequest.getDefaultInstance()).account.id
}

fun assertUnauthenticated(call: () -> Any) {
    val error = assertThrows<StatusRuntimeException> { call() }
    assertEquals(Status.Code.UNAUTHENTICATED, error.status.code, error.status.description)
}
