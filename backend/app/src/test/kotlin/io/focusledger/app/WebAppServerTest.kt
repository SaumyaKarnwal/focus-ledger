package io.focusledger.app

import com.linecorp.armeria.client.BlockingWebClient
import com.linecorp.armeria.client.WebClient
import com.linecorp.armeria.common.AggregatedHttpResponse
import com.linecorp.armeria.common.HttpData
import com.linecorp.armeria.common.HttpMethod
import com.linecorp.armeria.common.HttpStatus
import com.linecorp.armeria.common.MediaType
import com.linecorp.armeria.common.RequestHeaders
import io.focusledger.grpc.SessionCookies
import io.focusledger.mcp.FakeAccounts
import io.focusledger.mcp.FakeLedger
import io.focusledger.mcp.oauth.BrowserSessions
import io.focusledger.mcp.oauth.ClientLookup
import io.focusledger.mcp.oauth.ClientMetadataSource
import io.focusledger.mcp.oauth.InMemoryAgentConnections
import java.nio.file.Files
import java.time.Clock
import java.time.Duration
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource

/** Starts the whole program with a web build in WEB_DIR and checks what Armeria serves. */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class WebAppServerTest {
    private val clock = Clock.systemUTC()

    private val webDir =
        Files.createTempDirectory("web").also { dir ->
            Files.writeString(dir.resolve("index.html"), INDEX_HTML)
            Files.createDirectory(dir.resolve("assets"))
            Files.writeString(dir.resolve("assets/app.js"), APP_JS)
        }

    private val config =
        AppConfig.fromEnvironment(
            mapOf(
                AppConfig.PORT to "0",
                AppConfig.DB_URL_APP to "jdbc:postgresql://unused.invalid/focusledger",
                AppConfig.MCP_TOKEN_SIGNING_KEY to TestKeys.signingKey(),
                AppConfig.PUBLIC_BASE_URL to "https://$PUBLIC_HOST",
                AppConfig.SESSION_SIGNING_KEY to TestKeys.signingKey(),
                AppConfig.GOOGLE_CLIENT_ID to CLIENT_ID,
                AppConfig.WEB_DIR to webDir.toString(),
            )
        )

    private val server =
        FocusLedgerApp.start(
            config,
            AppServices(
                ledger = FakeLedger(clock),
                account = FakeAccounts(),
                agentConnections = InMemoryAgentConnections(clock),
                clientMetadata = ClientMetadataSource { ClientLookup.Invalid("unused") },
                browserSessions = BrowserSessions { null },
                sessionCookies = SessionCookies(config.sessionSigningKey, clock),
                clock = clock,
            ),
        )

    private val armeria: BlockingWebClient =
        WebClient.builder("http://127.0.0.1:${server.port}")
            .responseTimeout(Duration.ofSeconds(30))
            .build()
            .blocking()

    @AfterAll
    fun stopServer() {
        server.stop()
        webDir.toFile().deleteRecursively()
    }

    private fun get(path: String): AggregatedHttpResponse =
        armeria.execute(RequestHeaders.builder(HttpMethod.GET, path).authority(PUBLIC_HOST).build())

    @Test
    fun aFileInTheBuild_isServed() {
        val response = get("/assets/app.js")

        assertEquals(HttpStatus.OK, response.status())
        assertEquals(APP_JS, response.contentUtf8())
    }

    @ParameterizedTest
    @ValueSource(strings = ["/", "/index.html", "/nodes/42"])
    fun indexAndUnknownPaths_returnIndexWithTheClientId(path: String) {
        val response = get(path)

        assertEquals(HttpStatus.OK, response.status())
        assertEquals(MediaType.HTML_UTF_8, response.headers().contentType())
        assertTrue(
            response
                .contentUtf8()
                .contains("""<meta name="google-client-id" content="$CLIENT_ID""""),
            response.contentUtf8(),
        )
    }

    @Test
    fun anUnknownWellKnownPath_isNotFound() {
        assertEquals(HttpStatus.NOT_FOUND, get("/.well-known/openid-configuration").status())
    }

    @Test
    fun aPostToAnUnknownPath_doesNotReturnIndex() {
        val response =
            armeria.execute(
                RequestHeaders.builder(HttpMethod.POST, "/nodes/42").authority(PUBLIC_HOST).build()
            )

        assertTrue(response.status().isClientError, response.status().toString())
    }

    @Test
    fun theForwardedMetadataPath_stillReachesKtor() {
        val response = get("/.well-known/oauth-authorization-server")

        assertEquals(HttpStatus.OK, response.status())
        assertEquals(MediaType.JSON, response.headers().contentType()?.withoutParameters())
    }

    @Test
    fun aGrpcWebCall_isStillServedByGrpc() {
        val headers =
            RequestHeaders.builder(HttpMethod.POST, "/focusledger.v1.LedgerService/GetAccount")
                .contentType(MediaType.parse("application/grpc-web+proto"))
                .add("x-grpc-web", "1")
                .build()

        val response = armeria.execute(headers, HttpData.wrap(byteArrayOf(0, 0, 0, 0, 0)))

        assertEquals("16", response.headers().get("grpc-status"))
    }

    private companion object {
        const val PUBLIC_HOST = "ledger.example"
        const val CLIENT_ID = "test-client.apps.googleusercontent.com"
        const val APP_JS = "console.log('app');"
        val INDEX_HTML =
            """
            <!doctype html>
            <html><head><meta name="google-client-id" content="" /></head><body></body></html>
            """
                .trimIndent()
    }
}
