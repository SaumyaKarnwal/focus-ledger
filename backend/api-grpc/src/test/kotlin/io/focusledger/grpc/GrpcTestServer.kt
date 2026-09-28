package io.focusledger.grpc

import com.linecorp.armeria.client.ClientRequestContext
import com.linecorp.armeria.client.HttpClient
import com.linecorp.armeria.client.SimpleDecoratingHttpClient
import com.linecorp.armeria.client.grpc.GrpcClients
import com.linecorp.armeria.common.HttpHeaderNames
import com.linecorp.armeria.common.HttpRequest
import com.linecorp.armeria.common.HttpResponse
import com.linecorp.armeria.common.grpc.GrpcSerializationFormats
import com.linecorp.armeria.server.Server
import com.nimbusds.jose.JOSEObjectType
import com.nimbusds.jose.JWSAlgorithm
import com.nimbusds.jose.JWSHeader
import com.nimbusds.jose.crypto.RSASSASigner
import com.nimbusds.jose.jwk.JWKSet
import com.nimbusds.jose.jwk.RSAKey
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator
import com.nimbusds.jose.jwk.source.ImmutableJWKSet
import com.nimbusds.jwt.JWTClaimsSet
import com.nimbusds.jwt.SignedJWT
import focusledger.v1.LedgerServiceGrpc
import focusledger.v1.LedgerServiceOuterClass.SignInRequest
import io.focusledger.core.account.CoreAccountService
import io.focusledger.data.TestServices
import java.time.Duration
import java.time.Instant
import java.util.Date
import java.util.UUID

/**
 * Armeria with LedgerService on a random port, backed by the real services on the test Postgres. A
 * test key signs the Google ID tokens, because the real client ID is not set yet.
 */
class GrpcTestServer {
    val services = TestServices()
    val clock = services.clock
    val cookies = SessionCookies(TEST_SIGNING_KEY, clock)
    private val account =
        CoreAccountService(
            GoogleIdTokenVerifier(CLIENT_ID, ImmutableJWKSet(JWKSet(GOOGLE_KEY))),
            services.accounts,
            services.settings,
        )
    private val server: Server =
        Server.builder()
            .http(0)
            .service(LedgerGrpc.service(services.ledger, account, cookies))
            .build()
            .also { it.start().join() }

    val baseUrl = "http://127.0.0.1:${server.activeLocalPort()}"

    fun stop() {
        server.stop().join()
    }

    /** A gRPC-Web client, as the browser uses, with its own cookie jar. */
    fun browser(): Browser = Browser(baseUrl)

    /** A browser that has signed in as a new user with a verified email. */
    fun signedIn(email: String = "user-${UUID.randomUUID()}@example.com"): Browser =
        browser().also {
            it.stub.signIn(SignInRequest.newBuilder().setGoogleIdToken(idToken(email)).build())
        }

    /** A Google-style ID token that the test key signs. */
    fun idToken(
        email: String,
        verified: Boolean = true,
        audience: String = CLIENT_ID,
        issuer: String = "https://accounts.google.com",
        expiresIn: Duration = Duration.ofHours(1),
        key: RSAKey = GOOGLE_KEY,
    ): String {
        val now = Instant.now()
        val claims =
            JWTClaimsSet.Builder()
                .issuer(issuer)
                .audience(audience)
                .subject("google-${UUID.randomUUID()}")
                .claim("email", email)
                .claim("email_verified", verified)
                .issueTime(Date.from(now.minusSeconds(60)))
                .expirationTime(Date.from(now.plus(expiresIn)))
                .build()
        val header =
            JWSHeader.Builder(JWSAlgorithm.RS256).keyID(key.keyID).type(JOSEObjectType.JWT).build()
        return SignedJWT(header, claims).apply { sign(RSASSASigner(key)) }.serialize()
    }

    companion object {
        const val CLIENT_ID = "test-client.apps.googleusercontent.com"
        private val TEST_SIGNING_KEY = "test-session-signing-key-for-grpc-tests".toByteArray()
        val GOOGLE_KEY: RSAKey = RSAKeyGenerator(2048).keyID("test-google-key").generate()
        val OTHER_KEY: RSAKey = RSAKeyGenerator(2048).keyID("test-google-key").generate()
    }
}

/** One browser: a gRPC-Web client that stores the session cookie the server sets. */
class Browser(baseUrl: String) {
    /** The last Set-Cookie values the server sent, newest last. */
    val setCookies = mutableListOf<String>()

    /** The cookie that the browser sends, or null. */
    var cookie: String? = null

    val stub: LedgerServiceGrpc.LedgerServiceBlockingStub =
        GrpcClients.builder(baseUrl)
            .serializationFormat(GrpcSerializationFormats.PROTO_WEB)
            .decorator { delegate -> CookieJar(delegate, this) }
            .build(LedgerServiceGrpc.LedgerServiceBlockingStub::class.java)

    private class CookieJar(delegate: HttpClient, private val browser: Browser) :
        SimpleDecoratingHttpClient(delegate) {
        override fun execute(ctx: ClientRequestContext, req: HttpRequest): HttpResponse {
            val withCookie =
                browser.cookie?.let { cookie ->
                    req.withHeaders(req.headers().toBuilder().set(HttpHeaderNames.COOKIE, cookie))
                } ?: req
            ctx.updateRequest(withCookie)
            return unwrap().execute(ctx, withCookie).mapHeaders { headers ->
                headers.getAll(HttpHeaderNames.SET_COOKIE).forEach { setCookie ->
                    browser.setCookies += setCookie
                    val pair = setCookie.substringBefore(';')
                    browser.cookie = if (setCookie.contains("Max-Age=0")) null else pair
                }
                headers
            }
        }
    }
}
