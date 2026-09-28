package io.focusledger.mcp.oauth

import java.net.InetAddress
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource

class ClientMetadataTest {
    private val clientId = "https://agent.example/client.json"

    private fun document(
        id: String = clientId,
        name: String? = "Example Agent",
        redirectUris: String =
            """["http://localhost:33418/callback", "https://agent.example/cb"]""",
        extra: String = "",
    ) =
        """{"client_id": "$id", ${name?.let { "\"client_name\": \"$it\"," } ?: ""} "redirect_uris": $redirectUris $extra}"""

    private fun ClientLookup.reason(): String = (this as ClientLookup.Invalid).reason

    @Nested
    inner class ClientIdRules {
        @Test
        fun httpsUrlWithAPath_isAllowed() {
            assertNull(ClientMetadataRules.clientIdProblem(clientId))
        }

        @ParameterizedTest
        @ValueSource(
            strings =
                [
                    "http://agent.example/client.json",
                    "https://agent.example",
                    "https://agent.example/",
                    "https://agent.example/client.json#part",
                    "https://agent.example/client.json?x=1",
                    "https://user:pass@agent.example/client.json",
                    "https://127.0.0.1/client.json",
                    "https://2130706433/client.json",
                    "https://[::1]/client.json",
                    "https://agent.example/a/../client.json",
                    "not a url",
                ]
        )
        fun otherUrls_areRejected(candidate: String) {
            assertTrue(ClientMetadataRules.clientIdProblem(candidate) != null, candidate)
        }
    }

    @Nested
    inner class DocumentRules {
        @Test
        fun validDocument_isFound() {
            val lookup = ClientMetadataRules.parse(clientId, document())

            assertEquals(
                ClientLookup.Found(
                    ClientMetadata(
                        clientId,
                        "Example Agent",
                        listOf("http://localhost:33418/callback", "https://agent.example/cb"),
                    )
                ),
                lookup,
            )
        }

        @Test
        fun clientIdThatDiffersFromTheUrl_isRejected() {
            assertEquals(
                "The client_id in the metadata does not match the URL.",
                ClientMetadataRules.parse(
                        clientId,
                        document(id = "https://other.example/client.json"),
                    )
                    .reason(),
            )
        }

        @Test
        fun missingName_isRejected() {
            assertEquals(
                "The client metadata has no client_name.",
                ClientMetadataRules.parse(clientId, document(name = null)).reason(),
            )
        }

        @Test
        fun plainHttpRedirectToAnotherHost_isRejected() {
            assertEquals(
                "Every redirect URI must use https or a localhost address.",
                ClientMetadataRules.parse(
                        clientId,
                        document(redirectUris = """["http://agent.example/cb"]"""),
                    )
                    .reason(),
            )
        }

        @Test
        fun noRedirectUris_isRejected() {
            assertEquals(
                "The client metadata has no redirect_uris.",
                ClientMetadataRules.parse(clientId, document(redirectUris = "[]")).reason(),
            )
        }

        @Test
        fun confidentialClient_isRejected() {
            assertTrue(
                ClientMetadataRules.parse(
                        clientId,
                        document(extra = ", \"token_endpoint_auth_method\": \"private_key_jwt\""),
                    )
                    .reason()
                    .startsWith("Only public clients")
            )
        }

        @Test
        fun notJson_isRejectedWithoutTheBody() {
            val reason =
                ClientMetadataRules.parse(clientId, "<html>secret admin page</html>").reason()

            assertEquals("The client metadata is not a JSON object.", reason)
        }
    }

    @Nested
    inner class PublicOnlyPolicy {
        @ParameterizedTest
        @ValueSource(
            strings =
                [
                    "127.0.0.1",
                    "::1",
                    "0.0.0.0",
                    "10.1.2.3",
                    "172.16.0.1",
                    "192.168.1.1",
                    "169.254.169.254",
                    "100.64.0.1",
                    "198.18.0.1",
                    "240.0.0.1",
                    "224.0.0.1",
                    "fc00::1",
                    "fe80::1",
                    "64:ff9b::a00:1",
                    "::ffff:10.0.0.1",
                ]
        )
        fun internalAddresses_areRefused(address: String) {
            assertFalse(AddressPolicy.PUBLIC_ONLY.allows(InetAddress.getByName(address)), address)
        }

        @ParameterizedTest
        @ValueSource(strings = ["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111"])
        fun publicAddresses_areAllowed(address: String) {
            assertTrue(AddressPolicy.PUBLIC_ONLY.allows(InetAddress.getByName(address)), address)
        }
    }

    @Nested
    inner class HttpFetch {
        private val certificate =
            HeldCertificate.Builder().addSubjectAlternativeName("localhost").build()
        private val server =
            MockWebServer().apply {
                useHttps(
                    HandshakeCertificates.Builder()
                        .heldCertificate(certificate)
                        .build()
                        .sslSocketFactory()
                )
                start()
            }
        private val trustTestCertificate =
            HandshakeCertificates.Builder().addTrustedCertificate(certificate.certificate).build()

        /** The test server runs on loopback, so this source allows every address. */
        private val permissive =
            HttpClientMetadataSource(policy = { true }) {
                sslSocketFactory(
                    trustTestCertificate.sslSocketFactory(),
                    trustTestCertificate.trustManager,
                )
            }

        private val url = server.url("/client.json").toString()

        @AfterEach fun stopServer() = server.close()

        @Test
        fun validDocument_isFetched() {
            server.enqueue(MockResponse.Builder().body(document(id = url)).build())

            val lookup = permissive.lookUp(url)

            assertEquals("Example Agent", (lookup as ClientLookup.Found).metadata.clientName)
        }

        @Test
        fun defaultPolicy_refusesALoopbackHostBeforeConnecting() {
            val lookup = HttpClientMetadataSource().lookUp(url)

            assertEquals(
                "The client metadata URL points to an address that is not public.",
                lookup.reason(),
            )
            assertEquals(0, server.requestCount)
        }

        @Test
        fun redirect_isNotFollowed() {
            server.enqueue(
                MockResponse.Builder()
                    .code(302)
                    .addHeader("Location", "https://169.254.169.254/")
                    .build()
            )

            assertEquals("The client metadata URL answered 302.", permissive.lookUp(url).reason())
            assertEquals(1, server.requestCount)
        }

        @Test
        fun oversizedDocument_isRejected() {
            val padding = " ".repeat(HttpClientMetadataSource.MAX_BODY_BYTES.toInt())
            server.enqueue(MockResponse.Builder().body(document(id = url) + padding).build())

            assertTrue(
                permissive.lookUp(url).reason().startsWith("The client metadata is larger than")
            )
        }
    }
}
