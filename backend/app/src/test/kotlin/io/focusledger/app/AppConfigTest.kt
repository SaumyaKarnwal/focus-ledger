package io.focusledger.app

import java.io.File
import java.util.concurrent.TimeUnit
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource

class AppConfigTest {
    private val signingKey = TestKeys.signingKey()
    private val sessionKey = TestKeys.signingKey()
    private val environment =
        mapOf(
            AppConfig.PORT to "8080",
            AppConfig.DB_URL_APP to "jdbc:postgresql://localhost:5432/focusledger?user=test",
            AppConfig.MCP_TOKEN_SIGNING_KEY to signingKey,
            AppConfig.PUBLIC_BASE_URL to "https://ledger.example",
            AppConfig.SESSION_SIGNING_KEY to sessionKey,
            AppConfig.GOOGLE_CLIENT_ID to "test-client.apps.googleusercontent.com",
        )

    @Test
    fun completeEnvironment_givesTheSettings() {
        val config = AppConfig.fromEnvironment(environment)

        assertEquals(8080, config.port)
        assertEquals("https://ledger.example/mcp", config.oauth.resource)
        assertTrue(config.oauth.signingKey.contentEquals(signingKey.toByteArray()))
    }

    @Test
    fun shortSessionSigningKey_isRejected() {
        val error =
            assertThrows<ConfigException> {
                AppConfig.fromEnvironment(
                    environment + (AppConfig.SESSION_SIGNING_KEY to "too-short")
                )
            }

        assertEquals("SESSION_SIGNING_KEY must be at least 32 bytes.", error.message)
    }

    @ParameterizedTest
    @ValueSource(
        strings =
            [
                AppConfig.PORT,
                AppConfig.DB_URL_APP,
                AppConfig.MCP_TOKEN_SIGNING_KEY,
                AppConfig.PUBLIC_BASE_URL,
                AppConfig.SESSION_SIGNING_KEY,
                AppConfig.GOOGLE_CLIENT_ID,
            ]
    )
    fun missingVariable_namesIt(name: String) {
        val error = assertThrows<ConfigException> { AppConfig.fromEnvironment(environment - name) }

        assertEquals("Set the environment variable $name.", error.message)
    }

    @Test
    fun badPort_isRefused() {
        assertThrows<ConfigException> {
            AppConfig.fromEnvironment(environment + (AppConfig.PORT to "http"))
        }
    }

    @Test
    fun shortSigningKey_isRefusedWithoutShowingIt() {
        val error =
            assertThrows<ConfigException> {
                AppConfig.fromEnvironment(
                    environment + (AppConfig.MCP_TOKEN_SIGNING_KEY to "short-key")
                )
            }

        assertEquals("MCP_TOKEN_SIGNING_KEY must have at least 32 bytes.", error.message)
    }

    @Test
    fun toString_hidesTheSecrets() {
        val text = AppConfig.fromEnvironment(environment).toString()

        assertFalse(text.contains(signingKey))
        assertFalse(text.contains("jdbc:"))
    }

    @Test
    fun main_withAMissingVariable_stopsWithAMessage() {
        val java = File(System.getProperty("java.home"), "bin/java").path
        val process =
            ProcessBuilder(
                    java,
                    "-cp",
                    System.getProperty("java.class.path"),
                    "io.focusledger.app.MainKt",
                )
                .apply {
                    environment().clear()
                    environment().putAll(environment - AppConfig.MCP_TOKEN_SIGNING_KEY)
                }
                .redirectErrorStream(true)
                .start()

        assertTrue(process.waitFor(60, TimeUnit.SECONDS), "The program did not stop")
        val output = process.inputStream.bufferedReader().readText()
        assertEquals(1, process.exitValue(), output)
        assertTrue(
            output.contains(
                "Focus Ledger cannot start: Set the environment variable MCP_TOKEN_SIGNING_KEY."
            ),
            output,
        )
    }
}
