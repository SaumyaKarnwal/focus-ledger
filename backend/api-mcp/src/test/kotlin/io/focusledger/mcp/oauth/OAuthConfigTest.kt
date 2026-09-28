package io.focusledger.mcp.oauth

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

class OAuthConfigTest {
    private val key = ByteArray(32) { it.toByte() }

    @Test
    fun origin_givesTheEndpointsAndTheResource() {
        val config = OAuthConfig("https://example.com/", key)

        assertEquals("https://example.com", config.issuer)
        assertEquals("https://example.com/mcp", config.resource)
        assertEquals(
            "https://example.com/.well-known/oauth-protected-resource",
            config.resourceMetadataUrl,
        )
        assertEquals("https://example.com/oauth/token", config.tokenEndpoint)
    }

    @Test
    fun shortSigningKey_isRefused() {
        val error =
            assertThrows<IllegalArgumentException> {
                OAuthConfig("https://example.com", ByteArray(31))
            }

        assertEquals("MCP_TOKEN_SIGNING_KEY must have at least 32 bytes.", error.message)
    }

    @Test
    fun baseUrlWithAPath_isRefused() {
        assertThrows<IllegalArgumentException> { OAuthConfig("https://example.com/app", key) }
    }
}
