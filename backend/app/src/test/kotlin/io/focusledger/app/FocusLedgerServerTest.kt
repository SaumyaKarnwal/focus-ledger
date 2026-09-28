package io.focusledger.app

import com.linecorp.armeria.client.BlockingWebClient
import com.linecorp.armeria.client.WebClient
import com.linecorp.armeria.common.AggregatedHttpResponse
import com.linecorp.armeria.common.HttpHeaderNames
import com.linecorp.armeria.common.HttpMethod
import com.linecorp.armeria.common.HttpStatus
import com.linecorp.armeria.common.MediaType
import com.linecorp.armeria.common.QueryParams
import com.linecorp.armeria.common.RequestHeaders
import io.focusledger.core.UserId
import io.focusledger.mcp.FakeAccounts
import io.focusledger.mcp.FakeLedger
import io.focusledger.mcp.oauth.BrowserSessions
import io.focusledger.mcp.oauth.ClientLookup
import io.focusledger.mcp.oauth.ClientMetadata
import io.focusledger.mcp.oauth.ClientMetadataSource
import io.focusledger.mcp.oauth.InMemoryAgentConnections
import io.ktor.http.ContentType
import io.ktor.server.response.respondBytesWriter
import io.ktor.server.response.respondText
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import io.ktor.utils.io.writeStringUtf8
import java.net.URI
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.security.MessageDigest
import java.time.Clock
import java.time.Duration
import java.util.Base64
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.delay
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource

/** Starts the whole program on free ports and calls it through Armeria, as an agent would. */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class FocusLedgerServerTest {
    private val user = UserId(UUID.randomUUID())
    private val clock = Clock.systemUTC()
    private val ledger = FakeLedger(clock).apply { addNode(user, "Book") }
    private val clientId = "https://agent.example/client.json"
    private val redirectUri = "http://localhost:33418/callback"
    private val clients = ClientMetadataSource {
        ClientLookup.Found(ClientMetadata(clientId, "Example Agent", listOf(redirectUri)))
    }
    private val sessions = BrowserSessions { cookie ->
        cookie?.removePrefix("session=")?.let { UserId(UUID.fromString(it)) }
    }

    /** The requests that reached Ktor on a path that Armeria must not forward. */
    private val probeHits = AtomicInteger()

    private val config =
        AppConfig.fromEnvironment(
            mapOf(
                AppConfig.PORT to "0",
                AppConfig.DB_URL_APP to "jdbc:postgresql://unused.invalid/focusledger",
                AppConfig.MCP_TOKEN_SIGNING_KEY to TestKeys.signingKey(),
                AppConfig.PUBLIC_BASE_URL to "https://$PUBLIC_HOST",
            )
        )

    private val server =
        FocusLedgerApp.start(
            config,
            AppServices(
                ledger = ledger,
                account = FakeAccounts(),
                agentConnections = InMemoryAgentConnections(clock),
                clientMetadata = clients,
                browserSessions = sessions,
                clock = clock,
            ),
        ) {
            routing {
                // Test-only: a slow stream under a forwarded path, and probes on paths that
                // Armeria must keep.
                get("/oauth/test-stream") {
                    call.respondBytesWriter(ContentType.Text.EventStream) {
                        writeStringUtf8("data: first\n\n")
                        flush()
                        delay(STREAM_PAUSE.toMillis())
                        writeStringUtf8("data: last\n\n")
                        flush()
                    }
                }
                listOf("/", "/mcp/extra", "/oauth", "/.well-known/openid-configuration", "/app/x")
                    .forEach { path ->
                        get(path) {
                            probeHits.incrementAndGet()
                            call.respondText("reached Ktor")
                        }
                    }
            }
        }

    private val armeria: BlockingWebClient =
        WebClient.builder("http://127.0.0.1:${server.port}")
            .responseTimeout(Duration.ofSeconds(30))
            .build()
            .blocking()

    @AfterAll fun stopServer() = server.stop()

    private fun get(path: String, cookie: String? = null): AggregatedHttpResponse =
        armeria.execute(
            RequestHeaders.builder(HttpMethod.GET, path)
                .authority(PUBLIC_HOST)
                .apply { cookie?.let { add(HttpHeaderNames.COOKIE, it) } }
                .build()
        )

    private fun post(
        path: String,
        mediaType: MediaType,
        body: String,
        cookie: String? = null,
        bearer: String? = null,
    ): AggregatedHttpResponse =
        armeria.execute(
            RequestHeaders.builder(HttpMethod.POST, path)
                .authority(PUBLIC_HOST)
                .contentType(mediaType)
                .add(HttpHeaderNames.ACCEPT, "application/json, text/event-stream")
                .apply {
                    cookie?.let { add(HttpHeaderNames.COOKIE, it) }
                    bearer?.let { add(HttpHeaderNames.AUTHORIZATION, "Bearer $it") }
                }
                .build(),
            body,
        )

    private fun form(vararg fields: Pair<String, String>) =
        fields.joinToString("&") { (name, value) ->
            "$name=" + URLEncoder.encode(value, Charsets.UTF_8)
        }

    private fun json(response: AggregatedHttpResponse) =
        Json.parseToJsonElement(response.contentUtf8()).jsonObject

    /** The OAuth flow through Armeria: consent page, approval, and code exchange. */
    private fun accessToken(): String {
        val verifier = "v".repeat(50)
        val challenge =
            Base64.getUrlEncoder()
                .withoutPadding()
                .encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray()))
        val cookie = "session=${user.value}"
        val query =
            form(
                "response_type" to "code",
                "client_id" to clientId,
                "redirect_uri" to redirectUri,
                "code_challenge" to challenge,
                "code_challenge_method" to "S256",
                "resource" to config.oauth.resource,
            )
        val consentPage = get("/oauth/authorize?$query", cookie)
        assertEquals(HttpStatus.OK, consentPage.status(), consentPage.contentUtf8())
        val consent =
            Regex("""name="consent" value="([^"]+)"""")
                .find(consentPage.contentUtf8())!!
                .groupValues[1]

        val approval =
            post(
                "/oauth/authorize",
                MediaType.FORM_DATA,
                form("consent" to consent, "decision" to "approve"),
                cookie = cookie,
            )
        assertEquals(HttpStatus.FOUND, approval.status(), approval.contentUtf8())
        val code =
            QueryParams.fromQueryString(
                    URI(approval.headers().get(HttpHeaderNames.LOCATION)!!).rawQuery
                )
                .get("code")!!

        val tokens =
            post(
                "/oauth/token",
                MediaType.FORM_DATA,
                form(
                    "grant_type" to "authorization_code",
                    "code" to code,
                    "redirect_uri" to redirectUri,
                    "client_id" to clientId,
                    "code_verifier" to verifier,
                    "resource" to config.oauth.resource,
                ),
            )
        assertEquals(HttpStatus.OK, tokens.status(), tokens.contentUtf8())
        return json(tokens).getValue("access_token").jsonPrimitive.content
    }

    @Test
    fun metadataDocuments_areServedThroughArmeria() {
        val resource = get("/.well-known/oauth-protected-resource/mcp")
        val authorizationServer = get("/.well-known/oauth-authorization-server")

        assertEquals(HttpStatus.OK, resource.status())
        assertEquals(
            "https://$PUBLIC_HOST/mcp",
            json(resource).getValue("resource").jsonPrimitive.content,
        )
        assertEquals(HttpStatus.OK, authorizationServer.status())
        assertEquals(
            "https://$PUBLIC_HOST/oauth/token",
            json(authorizationServer).getValue("token_endpoint").jsonPrimitive.content,
        )
    }

    @Test
    fun mcpWithoutToken_gets401WithTheMetadataUrl() {
        val response =
            post("/mcp", MediaType.JSON, """{"jsonrpc":"2.0","id":1,"method":"tools/list"}""")

        assertEquals(HttpStatus.UNAUTHORIZED, response.status())
        assertEquals(
            "Bearer resource_metadata=\"https://$PUBLIC_HOST/.well-known/oauth-protected-resource\"",
            response.headers().get(HttpHeaderNames.WWW_AUTHENTICATE),
        )
    }

    @Test
    fun toolCall_throughArmeriaWithAnOAuthToken_returnsTheUsersTree() {
        val response =
            post(
                "/mcp",
                MediaType.JSON,
                """{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_nodes","arguments":{}}}""",
                bearer = accessToken(),
            )

        assertEquals(HttpStatus.OK, response.status(), response.contentUtf8())
        val text =
            json(response)
                .getValue("result")
                .jsonObject
                .getValue("content")
                .jsonArray
                .single()
                .jsonObject
                .getValue("text")
                .jsonPrimitive
                .content
        assertTrue(text.contains("\"Book\""), text)
    }

    @Test
    fun stream_passesThroughArmeriaAsItArrivesAndOutlivesTheDefaultTimeouts() {
        val started = System.nanoTime()
        val lines =
            HttpClient.newHttpClient()
                .send(
                    HttpRequest.newBuilder(URI("http://127.0.0.1:${server.port}/oauth/test-stream"))
                        .build(),
                    HttpResponse.BodyHandlers.ofLines(),
                )
                .body()
                .iterator()

        assertEquals("data: first", lines.next())
        val firstEventAfter = Duration.ofNanos(System.nanoTime() - started)
        val rest = lines.asSequence().filter { it.isNotEmpty() }.toList()
        val streamEndedAfter = Duration.ofNanos(System.nanoTime() - started)

        assertTrue(
            firstEventAfter < Duration.ofSeconds(3),
            "The first event came after $firstEventAfter",
        )
        assertEquals(listOf("data: last"), rest)
        assertTrue(streamEndedAfter >= STREAM_PAUSE, "The stream ended after $streamEndedAfter")
    }

    @ParameterizedTest
    @ValueSource(strings = ["/", "/mcp/extra", "/.well-known/openid-configuration", "/app/x"])
    fun otherPaths_stayInArmeria(path: String) {
        val before = probeHits.get()

        val response = get(path)

        assertEquals(HttpStatus.NOT_FOUND, response.status(), response.contentUtf8())
        assertEquals(before, probeHits.get(), "$path reached Ktor")
    }

    @Test
    fun forwardKeepsTheHost_soKtorRejectsAHostThatIsNotOurs() {
        val response =
            armeria.execute(
                RequestHeaders.builder(HttpMethod.POST, "/mcp")
                    .authority("attacker.example")
                    .contentType(MediaType.JSON)
                    .add(HttpHeaderNames.ACCEPT, "application/json, text/event-stream")
                    .add(HttpHeaderNames.AUTHORIZATION, "Bearer ${accessToken()}")
                    .build(),
                """{"jsonrpc":"2.0","id":1,"method":"tools/list"}""",
            )

        assertEquals(HttpStatus.FORBIDDEN, response.status(), response.contentUtf8())
    }

    @Test
    fun oauthWithoutTheSlash_isRedirectedByArmeriaAndDoesNotReachKtor() {
        val before = probeHits.get()

        val response = get("/oauth")

        assertEquals(HttpStatus.TEMPORARY_REDIRECT, response.status())
        assertEquals("oauth/", response.headers().get(HttpHeaderNames.LOCATION))
        assertEquals(before, probeHits.get())
    }

    private companion object {
        const val PUBLIC_HOST = "ledger.example"

        /** Longer than the 10-second defaults of Armeria's request and response timeouts. */
        val STREAM_PAUSE: Duration = Duration.ofSeconds(12)
    }
}
