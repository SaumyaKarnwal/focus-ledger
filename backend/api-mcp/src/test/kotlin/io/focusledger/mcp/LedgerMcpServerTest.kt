package io.focusledger.mcp

import io.focusledger.core.UserId
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import java.time.Instant
import java.util.UUID
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class LedgerMcpServerTest {
    private val userA = UserId(UUID.randomUUID())
    private val userB = UserId(UUID.randomUUID())
    private val clock = TestClock(Instant.parse("2026-11-01T20:00:00Z"))
    private val ledger = FakeLedger(clock).apply { addNode(userA, "Book") }
    private val tokens = mapOf("test-token-a" to userA, "test-token-b" to userB)

    private companion object {
        const val RESOURCE_METADATA_URL = "http://localhost/.well-known/oauth-protected-resource"
    }

    private fun mcpTest(block: suspend ApplicationTestBuilder.() -> Unit) = testApplication {
        application {
            ledgerMcp(
                LedgerTools(ledger, FakeAccounts(), clock),
                authenticator = { token -> tokens[token] },
                allowedHosts = listOf("localhost"),
                resourceMetadataUrl = RESOURCE_METADATA_URL,
            )
        }
        block()
    }

    private suspend fun ApplicationTestBuilder.rpc(
        token: String?,
        body: String,
        host: String = "localhost",
    ): HttpResponse =
        client.post(MCP_PATH) {
            header(HttpHeaders.Host, host)
            token?.let { header(HttpHeaders.Authorization, "Bearer $it") }
            header(HttpHeaders.Accept, "application/json, text/event-stream")
            contentType(ContentType.Application.Json)
            setBody(body)
        }

    private suspend fun HttpResponse.result(): JsonObject {
        assertEquals(HttpStatusCode.OK, status, bodyAsText())
        return Json.parseToJsonElement(bodyAsText()).jsonObject.getValue("result").jsonObject
    }

    private fun toolCall(tool: String, arguments: String = "{}") =
        """{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"$tool","arguments":$arguments}}"""

    @Test
    fun noToken_gets401() = mcpTest {
        val response = rpc(token = null, toolCall(LIST_NODES))

        assertEquals(HttpStatusCode.Unauthorized, response.status)
        assertEquals(
            "Bearer resource_metadata=\"$RESOURCE_METADATA_URL\"",
            response.headers[HttpHeaders.WWWAuthenticate],
        )
    }

    @Test
    fun invalidToken_gets401WithInvalidTokenError() = mcpTest {
        val response = rpc("test-token-unknown", toolCall(LIST_NODES))

        assertEquals(HttpStatusCode.Unauthorized, response.status)
        assertEquals(
            "Bearer resource_metadata=\"$RESOURCE_METADATA_URL\", error=\"invalid_token\"",
            response.headers[HttpHeaders.WWWAuthenticate],
        )
    }

    @Test
    fun hostNotAllowed_gets403() = mcpTest {
        assertEquals(
            HttpStatusCode.Forbidden,
            rpc("test-token-a", toolCall(LIST_NODES), host = "attacker.example").status,
        )
    }

    @Test
    fun unknownToken_gets401() = mcpTest {
        assertEquals(
            HttpStatusCode.Unauthorized,
            rpc("test-token-unknown", toolCall(LIST_NODES)).status,
        )
    }

    @Test
    fun toolsList_returnsTheEightTools() = mcpTest {
        val result =
            rpc("test-token-a", """{"jsonrpc":"2.0","id":1,"method":"tools/list"}""").result()

        val names =
            result.getValue("tools").jsonArray.map {
                it.jsonObject.getValue("name").jsonPrimitive.content
            }
        assertEquals(
            listOf(
                LIST_NODES,
                CREATE_NODE,
                START_CYCLE,
                STOP_CYCLE,
                GET_RUNNING_CYCLE,
                LOG_CYCLE,
                FILE_CYCLE,
                SET_ESTIMATE,
            ),
            names,
        )
    }

    @Test
    fun initialize_sendsTheInstructions() = mcpTest {
        val result =
            rpc(
                    "test-token-a",
                    """{"jsonrpc":"2.0","id":1,"method":"initialize","params":""" +
                        """{"protocolVersion":"2025-06-18","capabilities":{},""" +
                        """"clientInfo":{"name":"test","version":"1"}}}""",
                )
                .result()

        val instructions = result.getValue("instructions").jsonPrimitive.content
        assertTrue(instructions.startsWith("Focus Ledger records how the user spends time."))
        assertTrue(instructions.contains("time_zone"), instructions)
        assertTrue(result.getValue("capabilities").jsonObject.containsKey("prompts"))
    }

    @Test
    fun promptsList_returnsTheTwoPrompts() = mcpTest {
        val result =
            rpc("test-token-a", """{"jsonrpc":"2.0","id":1,"method":"prompts/list"}""").result()

        val names =
            result.getValue("prompts").jsonArray.map {
                it.jsonObject.getValue("name").jsonPrimitive.content
            }
        assertEquals(listOf(LOG_SESSION, PLAN_PROJECT), names)
    }

    private suspend fun ApplicationTestBuilder.promptText(name: String, arguments: String): String =
        rpc(
                "test-token-a",
                """{"jsonrpc":"2.0","id":1,"method":"prompts/get",""" +
                    """"params":{"name":"$name","arguments":$arguments}}""",
            )
            .result()
            .getValue("messages")
            .jsonArray
            .single()
            .jsonObject
            .getValue("content")
            .jsonObject
            .getValue("text")
            .jsonPrimitive
            .content

    @Test
    fun logSessionPrompt_asksForAYesBeforeLoggingAndAddsTheNotes() = mcpTest {
        val text = promptText(LOG_SESSION, """{"notes":"Fixed the redirect bug"}""")

        assertTrue(text.contains("After I say yes, call log_cycle"), text)
        assertTrue(text.endsWith("My notes: Fixed the redirect bug"), text)
    }

    @Test
    fun logSessionPrompt_withoutNotes_hasNoNotesLine() = mcpTest {
        assertFalse(promptText(LOG_SESSION, "{}").contains("My notes"))
    }

    @Test
    fun planProjectPrompt_namesTheProjectAndTheParent() = mcpTest {
        val text = promptText(PLAN_PROJECT, """{"project":"Website","parent_path":"Work"}""")

        assertTrue(text.startsWith("Plan the node tree for the project \"Website\""), text)
        assertTrue(text.contains("under \"Work\""), text)
        assertTrue(text.contains("Create nothing yet."), text)
    }

    @Test
    fun promptsList_withoutAToken_gets401() = mcpTest {
        val response = rpc(null, """{"jsonrpc":"2.0","id":1,"method":"prompts/list"}""")

        assertEquals(HttpStatusCode.Unauthorized, response.status)
    }

    @Test
    fun toolCall_actsForTheTokensUser() = mcpTest {
        fun JsonObject.text() =
            getValue("content").jsonArray.single().jsonObject.getValue("text").jsonPrimitive.content

        val forA = rpc("test-token-a", toolCall(LIST_NODES)).result().text()
        val forB = rpc("test-token-b", toolCall(LIST_NODES)).result().text()

        assertTrue(forA.contains("\"Book\""), forA)
        assertFalse(forB.contains("Book"), forB)
    }

    @Test
    fun toolError_isAnErrorResult() = mcpTest {
        val result = rpc("test-token-a", toolCall(START_CYCLE, """{"mode":"focus"}""")).result()

        assertEquals("true", result.getValue("isError").jsonPrimitive.content)
    }
}
