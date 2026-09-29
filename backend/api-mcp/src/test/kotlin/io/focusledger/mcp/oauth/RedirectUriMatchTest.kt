package io.focusledger.mcp.oauth

import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource

class RedirectUriMatchTest {
    private val client =
        ClientMetadata(
            clientId = "https://agent.example/client.json",
            clientName = "Example Agent",
            redirectUris =
                listOf(
                    "http://localhost/callback",
                    "http://127.0.0.1/callback",
                    "http://[::1]/callback",
                    "http://localhost:33418/fixed",
                    "https://agent.example/cb",
                ),
        )

    @ParameterizedTest
    @ValueSource(
        strings =
            [
                "http://localhost:52017/callback",
                "http://127.0.0.1:52017/callback",
                "http://[::1]:52017/callback",
                "http://localhost/callback",
            ]
    )
    fun loopbackUri_withAnyPort_passes(requested: String) {
        assertTrue(client.allowsRedirectUri(requested))
    }

    @Test
    fun loopbackUri_withADifferentPath_fails() {
        assertFalse(client.allowsRedirectUri("http://localhost:52017/other"))
    }

    @ParameterizedTest
    @ValueSource(
        strings =
            [
                "http://localhost.attacker.example:52017/callback",
                "http://127.0.0.2:52017/callback",
                "https://localhost:52017/callback",
            ]
    )
    fun loopbackUri_withADifferentHostOrScheme_fails(requested: String) {
        assertFalse(client.allowsRedirectUri(requested))
    }

    @ParameterizedTest
    @ValueSource(
        strings =
            [
                "http://localhost:52017/callback?next=x",
                "http://localhost:52017/callback#x",
                "http://user@localhost:52017/callback",
            ]
    )
    fun loopbackUri_withAQueryFragmentOrUser_fails(requested: String) {
        assertFalse(client.allowsRedirectUri(requested))
    }

    @Test
    fun registeredLoopbackUriWithAPort_isAnExactMatch() {
        assertTrue(client.allowsRedirectUri("http://localhost:33418/fixed"))
        assertFalse(client.allowsRedirectUri("http://localhost:52017/fixed"))
    }

    @Test
    fun nonLoopbackUri_withADifferentPort_fails() {
        assertTrue(client.allowsRedirectUri("https://agent.example/cb"))
        assertFalse(client.allowsRedirectUri("https://agent.example:8443/cb"))
    }
}
