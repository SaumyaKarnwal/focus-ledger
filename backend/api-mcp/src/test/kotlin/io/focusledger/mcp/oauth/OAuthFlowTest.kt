package io.focusledger.mcp.oauth

import com.nimbusds.jose.JOSEObjectType
import com.nimbusds.jose.JWSAlgorithm
import com.nimbusds.jose.JWSHeader
import com.nimbusds.jose.crypto.MACSigner
import com.nimbusds.jwt.JWTClaimsSet
import com.nimbusds.jwt.SignedJWT
import io.focusledger.core.UserId
import io.focusledger.mcp.FakeAccounts
import io.focusledger.mcp.FakeLedger
import io.focusledger.mcp.LIST_NODES
import io.focusledger.mcp.LedgerTools
import io.focusledger.mcp.MCP_PATH
import io.focusledger.mcp.TestClock
import io.focusledger.mcp.ledgerMcp
import io.ktor.client.HttpClient
import io.ktor.client.request.forms.submitForm
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.Url
import io.ktor.http.contentType
import io.ktor.http.parameters
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import java.net.URLEncoder
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Duration
import java.time.Instant
import java.util.Base64
import java.util.Date
import java.util.UUID
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class OAuthFlowTest {
    private val userA = UserId(UUID.randomUUID())
    private val userB = UserId(UUID.randomUUID())
    private val clock = TestClock(Instant.parse("2026-11-01T20:00:00Z"))
    private val signingKey = ByteArray(32).also(SecureRandom()::nextBytes)
    private val config = OAuthConfig("http://localhost", signingKey)
    private val connections = InMemoryAgentConnections(clock)
    private val ledger = FakeLedger(clock).apply { addNode(userA, "Book") }

    private val clientId = "https://agent.example/client.json"
    private val redirectUri = "http://localhost:33418/callback"
    private var clientName = "Example Agent"
    private val clients = ClientMetadataSource { id ->
        if (id == clientId) {
            ClientLookup.Found(ClientMetadata(clientId, clientName, listOf(redirectUri)))
        } else {
            ClientLookup.Invalid("The client metadata could not be fetched.")
        }
    }

    /** The test browser sends `Cookie: session=<user id>`. */
    private val sessions = BrowserSessions { cookie ->
        cookie?.removePrefix("session=")?.let { UserId(UUID.fromString(it)) }
    }
    private val oauth = OAuthServer(config, connections, clients, sessions, clock)

    private val verifier = "a".repeat(20) + "-verifier-" + "b".repeat(20)
    private val challenge =
        Base64.getUrlEncoder()
            .withoutPadding()
            .encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray()))

    private fun oauthTest(block: suspend ApplicationTestBuilder.(HttpClient) -> Unit) =
        testApplication {
            application {
                ledgerMcp(
                    LedgerTools(ledger, FakeAccounts(), clock),
                    oauth,
                    allowedHosts = listOf("localhost"),
                    resourceMetadataUrl = config.resourceMetadataUrl,
                )
                ledgerOAuth(oauth)
            }
            block(createClient { followRedirects = false })
        }

    private fun authorizeUrl(vararg overrides: Pair<String, String?>): String {
        val parameters =
            (mapOf(
                    "response_type" to "code",
                    "client_id" to clientId,
                    "redirect_uri" to redirectUri,
                    "code_challenge" to challenge,
                    "code_challenge_method" to "S256",
                    "state" to "state-1",
                    "resource" to config.resource,
                ) + overrides)
                .filterValues { it != null }
        return OAuthConfig.AUTHORIZE_PATH +
            "?" +
            parameters.entries.joinToString("&") { (name, value) ->
                "$name=" + URLEncoder.encode(value, Charsets.UTF_8)
            }
    }

    private suspend fun HttpClient.consentPage(
        userId: UserId,
        url: String = authorizeUrl(),
    ): HttpResponse = get(url) { header(HttpHeaders.Cookie, "session=${userId.value}") }

    private val consentField = Regex("""name="consent" value="([^"]+)"""")

    private suspend fun HttpClient.consentToken(userId: UserId): String {
        val page = consentPage(userId)
        assertEquals(HttpStatusCode.OK, page.status, page.bodyAsText())
        return consentField.find(page.bodyAsText())!!.groupValues[1]
    }

    private suspend fun HttpClient.decide(
        userId: UserId?,
        consentToken: String,
        decision: String = "approve",
    ): HttpResponse =
        submitForm(
            OAuthConfig.AUTHORIZE_PATH,
            parameters {
                append("consent", consentToken)
                append("decision", decision)
            },
        ) {
            userId?.let { header(HttpHeaders.Cookie, "session=${it.value}") }
        }

    /** The query of the redirect in [response]. */
    private fun redirectQuery(response: HttpResponse): Map<String, String> {
        assertEquals(HttpStatusCode.Found, response.status)
        val location = Url(response.headers[HttpHeaders.Location]!!)
        assertEquals(redirectUri, location.toString().substringBefore('?'))
        return location.parameters.entries().associate { (name, values) -> name to values.single() }
    }

    private suspend fun HttpClient.loginCode(userId: UserId): String =
        redirectQuery(decide(userId, consentToken(userId))).getValue("code")

    private suspend fun HttpClient.token(vararg fields: Pair<String, String?>): HttpResponse =
        submitForm(
            OAuthConfig.TOKEN_PATH,
            parameters { fields.forEach { (name, value) -> value?.let { append(name, it) } } },
        )

    private suspend fun HttpClient.redeem(
        code: String,
        codeVerifier: String? = verifier,
        redirect: String = redirectUri,
        client: String = clientId,
    ): HttpResponse =
        token(
            "grant_type" to "authorization_code",
            "code" to code,
            "redirect_uri" to redirect,
            "client_id" to client,
            "code_verifier" to codeVerifier,
            "resource" to config.resource,
        )

    private suspend fun HttpClient.refresh(refreshToken: String, client: String = clientId) =
        token(
            "grant_type" to "refresh_token",
            "refresh_token" to refreshToken,
            "client_id" to client,
            "resource" to config.resource,
        )

    private suspend fun HttpResponse.json(): JsonObject =
        Json.parseToJsonElement(bodyAsText()).jsonObject

    private suspend fun HttpResponse.tokens(): Pair<String, String> {
        assertEquals(HttpStatusCode.OK, status, bodyAsText())
        val body = json()
        return body.getValue("access_token").jsonPrimitive.content to
            body.getValue("refresh_token").jsonPrimitive.content
    }

    private suspend fun HttpResponse.assertTokenError(error: String) {
        assertEquals(HttpStatusCode.BadRequest, status, bodyAsText())
        assertEquals(error, json().getValue("error").jsonPrimitive.content, bodyAsText())
    }

    private suspend fun HttpClient.signIn(userId: UserId): Pair<String, String> =
        redeem(loginCode(userId)).tokens()

    private suspend fun HttpClient.listNodes(accessToken: String): HttpResponse =
        post(MCP_PATH) {
            header(HttpHeaders.Host, "localhost")
            header(HttpHeaders.Authorization, "Bearer $accessToken")
            header(HttpHeaders.Accept, "application/json, text/event-stream")
            contentType(ContentType.Application.Json)
            setBody(
                """{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"$LIST_NODES","arguments":{}}}"""
            )
        }

    private suspend fun HttpResponse.toolText(): String {
        assertEquals(HttpStatusCode.OK, status, bodyAsText())
        return json()
            .getValue("result")
            .jsonObject
            .getValue("content")
            .jsonArray
            .single()
            .jsonObject
            .getValue("text")
            .jsonPrimitive
            .content
    }

    /** A token with every claim of an access token, signed with [key], for [audience]. */
    private fun forgedAccessToken(
        audience: String,
        key: ByteArray = signingKey,
        type: String = "at+jwt",
    ): String {
        val claims =
            JWTClaimsSet.Builder()
                .issuer(config.issuer)
                .subject(userA.value.toString())
                .audience(audience)
                .expirationTime(Date.from(clock.now.plusSeconds(600)))
                .jwtID(UUID.randomUUID().toString())
                .build()
        val header = JWSHeader.Builder(JWSAlgorithm.HS256).type(JOSEObjectType(type)).build()
        return SignedJWT(header, claims).apply { sign(MACSigner(key)) }.serialize()
    }

    @Test
    fun metadata_pointsClientsToTheEndpoints() = oauthTest { client ->
        val atPath = client.get(OAuthConfig.PROTECTED_RESOURCE_METADATA_PATH + MCP_PATH).json()
        val atRoot = client.get(OAuthConfig.PROTECTED_RESOURCE_METADATA_PATH).json()
        val server = client.get(OAuthConfig.AUTHORIZATION_SERVER_METADATA_PATH).json()

        assertEquals(atPath, atRoot)
        assertEquals("http://localhost/mcp", atPath.getValue("resource").jsonPrimitive.content)
        assertEquals(
            "http://localhost",
            atPath.getValue("authorization_servers").jsonArray.single().jsonPrimitive.content,
        )
        assertEquals("http://localhost", server.getValue("issuer").jsonPrimitive.content)
        assertEquals(
            "http://localhost/oauth/authorize",
            server.getValue("authorization_endpoint").jsonPrimitive.content,
        )
        assertEquals(
            "http://localhost/oauth/token",
            server.getValue("token_endpoint").jsonPrimitive.content,
        )
        assertEquals(
            "S256",
            server
                .getValue("code_challenge_methods_supported")
                .jsonArray
                .single()
                .jsonPrimitive
                .content,
        )
        assertEquals(
            "true",
            server.getValue("client_id_metadata_document_supported").jsonPrimitive.content,
        )
    }

    @Test
    fun mcpWithoutToken_401PointsToTheResourceMetadata() = oauthTest { client ->
        val response =
            client.post(MCP_PATH) {
                header(HttpHeaders.Host, "localhost")
                setBody("{}")
            }

        assertEquals(HttpStatusCode.Unauthorized, response.status)
        assertEquals(
            "Bearer resource_metadata=\"http://localhost/.well-known/oauth-protected-resource\"",
            response.headers[HttpHeaders.WWWAuthenticate],
        )
    }

    @Test
    fun fullFlow_givesTokensThatWorkAtMcp() = oauthTest { client ->
        val redirect = redirectQuery(client.decide(userA, client.consentToken(userA)))
        assertEquals("state-1", redirect["state"])
        assertEquals(config.issuer, redirect["iss"])

        val (accessToken, refreshToken) = client.redeem(redirect.getValue("code")).tokens()

        assertTrue(client.listNodes(accessToken).toolText().contains("\"Book\""))
        assertEquals(userA, connections.all().single().userId)
        assertEquals(clientId, connections.all().single().clientId)
        assertTrue(
            refreshToken.startsWith("${userA.value}.${connections.all().single().id.value}.")
        )
    }

    @Test
    fun tokenResponse_isNotCached() = oauthTest { client ->
        val response = client.redeem(client.loginCode(userA))

        assertEquals("no-store", response.headers[HttpHeaders.CacheControl])
    }

    @Test
    fun consentPage_showsTheClientAndRedirectHostEscaped() = oauthTest { client ->
        clientName = "<script>alert(1)</script> Agent"

        val page = client.consentPage(userA)
        val html = page.bodyAsText()

        assertTrue(html.contains("&lt;script&gt;alert(1)&lt;/script&gt; Agent"), html)
        assertFalse(html.contains("<script>"), html)
        assertTrue(html.contains("<strong>localhost</strong>"), html)
        assertTrue(html.contains("on your own computer"), html)
        assertEquals("DENY", page.headers["X-Frame-Options"])
        assertTrue(page.headers["Content-Security-Policy"]!!.contains("frame-ancestors 'none'"))
    }

    @Test
    fun noSession_redirectsToSignInAndBack() = oauthTest { client ->
        val response = client.get(authorizeUrl())

        assertEquals(HttpStatusCode.Found, response.status)
        val location = response.headers[HttpHeaders.Location]!!
        assertTrue(location.startsWith("/app/?return_to=%2Foauth%2Fauthorize%3F"), location)
    }

    @Test
    fun deny_redirectsWithAccessDenied() = oauthTest { client ->
        val redirect =
            redirectQuery(client.decide(userA, client.consentToken(userA), decision = "deny"))

        assertEquals("access_denied", redirect["error"])
        assertEquals("state-1", redirect["state"])
        assertNull(redirect["code"])
        assertTrue(connections.all().isEmpty())
    }

    @Test
    fun attack_reusedCode_isRejectedAndRevokesItsConnection() = oauthTest { client ->
        val code = client.loginCode(userA)
        val (_, refreshToken) = client.redeem(code).tokens()

        client.redeem(code).assertTokenError("invalid_grant")

        assertNotNull(connections.all().single().revokedAt)
        client.refresh(refreshToken).assertTokenError("invalid_grant")
    }

    @Test
    fun attack_expiredCode_isRejected() = oauthTest { client ->
        val code = client.loginCode(userA)
        clock.now = clock.now.plus(Duration.ofSeconds(61))

        client.redeem(code).assertTokenError("invalid_grant")
        assertTrue(connections.all().isEmpty())
    }

    @Test
    fun attack_unregisteredRedirectUri_showsAnErrorAndDoesNotRedirect() = oauthTest { client ->
        val response =
            client.consentPage(userA, authorizeUrl("redirect_uri" to "https://attacker.example/cb"))

        assertEquals(HttpStatusCode.BadRequest, response.status)
        assertNull(response.headers[HttpHeaders.Location])
        assertTrue(
            response.bodyAsText().contains("not one of the client&#39;s registered redirect URIs")
        )
    }

    @Test
    fun attack_wrongRedirectUriAtTokenEndpoint_isRejected() = oauthTest { client ->
        client
            .redeem(client.loginCode(userA), redirect = "http://localhost:33418/other")
            .assertTokenError("invalid_grant")
        assertTrue(connections.all().isEmpty())
    }

    @Test
    fun attack_unknownClient_showsAnErrorAndDoesNotRedirect() = oauthTest { client ->
        val response =
            client.consentPage(
                userA,
                authorizeUrl("client_id" to "https://attacker.example/client.json"),
            )

        assertEquals(HttpStatusCode.BadRequest, response.status)
        assertNull(response.headers[HttpHeaders.Location])
    }

    @Test
    fun attack_missingPkceVerifier_isRejected() = oauthTest { client ->
        client
            .redeem(client.loginCode(userA), codeVerifier = null)
            .assertTokenError("invalid_request")
        assertTrue(connections.all().isEmpty())
    }

    @Test
    fun attack_wrongPkceVerifier_isRejected() = oauthTest { client ->
        client
            .redeem(client.loginCode(userA), codeVerifier = "c".repeat(50))
            .assertTokenError("invalid_grant")
        assertTrue(connections.all().isEmpty())
    }

    @Test
    fun attack_authorizationWithoutPkce_redirectsWithInvalidRequest() = oauthTest { client ->
        val redirect =
            redirectQuery(client.consentPage(userA, authorizeUrl("code_challenge" to null)))

        assertEquals("invalid_request", redirect["error"])
        assertEquals("state-1", redirect["state"])
    }

    @Test
    fun attack_codeForAnotherClient_isRejected() = oauthTest { client ->
        client
            .redeem(client.loginCode(userA), client = "https://attacker.example/client.json")
            .assertTokenError("invalid_grant")
    }

    @Test
    fun attack_tokenForAnotherAudience_gets401() = oauthTest { client ->
        val response = client.listNodes(forgedAccessToken(audience = "https://other.example/mcp"))

        assertEquals(HttpStatusCode.Unauthorized, response.status)
        assertTrue(
            response.headers[HttpHeaders.WWWAuthenticate]!!.contains("error=\"invalid_token\"")
        )
    }

    @Test
    fun attack_tokenSignedWithAnotherKey_gets401() = oauthTest { client ->
        val otherKey = ByteArray(32).also(SecureRandom()::nextBytes)

        assertEquals(
            HttpStatusCode.Unauthorized,
            client.listNodes(forgedAccessToken(config.resource, key = otherKey)).status,
        )
    }

    @Test
    fun attack_loginCodeUsedAsAccessToken_gets401() = oauthTest { client ->
        assertEquals(HttpStatusCode.Unauthorized, client.listNodes(client.loginCode(userA)).status)
        assertEquals(
            HttpStatusCode.Unauthorized,
            client
                .listNodes(forgedAccessToken(config.resource, type = "focusledger-code+jwt"))
                .status,
        )
    }

    @Test
    fun attack_expiredAccessToken_gets401() = oauthTest { client ->
        val (accessToken, _) = client.signIn(userA)
        clock.now = clock.now.plus(Duration.ofHours(1)).plusSeconds(1)

        assertEquals(HttpStatusCode.Unauthorized, client.listNodes(accessToken).status)
    }

    @Test
    fun refresh_rotatesTheRefreshToken() = oauthTest { client ->
        val (_, firstRefresh) = client.signIn(userA)

        val (accessToken, secondRefresh) = client.refresh(firstRefresh).tokens()

        assertTrue(secondRefresh != firstRefresh)
        assertTrue(client.listNodes(accessToken).toolText().contains("\"Book\""))
        client.refresh(secondRefresh).tokens()
    }

    @Test
    fun attack_reusedRefreshToken_isRejectedAndRevokesTheConnection() = oauthTest { client ->
        val (_, oldRefresh) = client.signIn(userA)
        val (_, currentRefresh) = client.refresh(oldRefresh).tokens()

        client.refresh(oldRefresh).assertTokenError("invalid_grant")

        assertNotNull(connections.all().single().revokedAt)
        client.refresh(currentRefresh).assertTokenError("invalid_grant")
    }

    @Test
    fun attack_refreshByAnotherClient_isRejected() = oauthTest { client ->
        val (_, refreshToken) = client.signIn(userA)

        client
            .refresh(refreshToken, client = "https://attacker.example/client.json")
            .assertTokenError("invalid_grant")
        client.refresh(refreshToken).tokens()
    }

    @Test
    fun attack_malformedRefreshToken_isRejectedWithNoSideEffect() = oauthTest { client ->
        client.signIn(userA)

        client.refresh("not-a-token").assertTokenError("invalid_grant")
        assertNull(connections.all().single().revokedAt)
    }

    @Test
    fun attack_consentPostedWithoutSession_isRejected() = oauthTest { client ->
        val response = client.decide(userId = null, client.consentToken(userA))

        assertEquals(HttpStatusCode.BadRequest, response.status)
        assertNull(response.headers[HttpHeaders.Location])
    }

    @Test
    fun attack_consentOfAnotherUser_isRejected() = oauthTest { client ->
        val response = client.decide(userB, client.consentToken(userA))

        assertEquals(HttpStatusCode.BadRequest, response.status)
        assertNull(response.headers[HttpHeaders.Location])
    }

    @Test
    fun attack_tamperedConsentToken_isRejected() = oauthTest { client ->
        val token = client.consentToken(userA)

        assertEquals(
            HttpStatusCode.BadRequest,
            client.decide(userA, token.dropLast(2) + "xx").status,
        )
    }

    @Test
    fun attack_wrongResource_isRejected() = oauthTest { client ->
        val redirect =
            redirectQuery(
                client.consentPage(userA, authorizeUrl("resource" to "https://other.example/mcp"))
            )

        assertEquals("invalid_target", redirect["error"])
    }

    @Test
    fun attack_repeatedParameter_isRejected() = oauthTest { client ->
        val code = client.loginCode(userA)
        val response =
            client.submitForm(
                OAuthConfig.TOKEN_PATH,
                parameters {
                    append("grant_type", "authorization_code")
                    append("code", code)
                    append("redirect_uri", redirectUri)
                    append("client_id", clientId)
                    append("code_verifier", verifier)
                    append("resource", config.resource)
                    append("resource", "https://other.example/mcp")
                },
            )

        response.assertTokenError("invalid_request")
        assertEquals(
            HttpStatusCode.BadRequest,
            client.consentPage(userA, authorizeUrl() + "&state=state-2").status,
        )
    }

    @Test
    fun userIsolation_userBsTokenCannotReadOrChangeUserAsData() = oauthTest { client ->
        val (tokenOfB, _) = client.signIn(userB)
        val nodesOfA = ledger.nodesOf(userA)

        val text = client.listNodes(tokenOfB).toolText()

        assertFalse(text.contains("Book"), text)
        assertEquals(nodesOfA, ledger.nodesOf(userA))
        assertEquals(setOf(userB), connections.all().map { it.userId }.toSet())
    }
}
