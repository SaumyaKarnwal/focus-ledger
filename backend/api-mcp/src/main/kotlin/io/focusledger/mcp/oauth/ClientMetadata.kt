package io.focusledger.mcp.oauth

import java.io.IOException
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import java.net.Proxy
import java.net.URI
import java.net.URISyntaxException
import java.net.UnknownHostException
import java.time.Duration
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import okhttp3.Dns
import okhttp3.OkHttpClient
import okhttp3.Request

/** The fields of a Client ID Metadata Document that the server uses. */
data class ClientMetadata(
    val clientId: String,
    val clientName: String,
    val redirectUris: List<String>,
) {
    /**
     * An exact match, except that a registered `http` loopback URI accepts any port (RFC 8252,
     * section 7.3): a local agent picks a free port for each sign-in.
     */
    fun allowsRedirectUri(requested: String): Boolean =
        requested in redirectUris || redirectUris.any { matchesLoopbackWithAnyPort(it, requested) }
}

private fun matchesLoopbackWithAnyPort(registered: String, requested: String): Boolean {
    val registeredUri = parseUri(registered) ?: return false
    val requestedUri = parseUri(requested) ?: return false
    return registeredUri.scheme == "http" &&
        ClientMetadataRules.isLoopbackHost(registeredUri.host) &&
        registeredUri.rawUserInfo == null &&
        requestedUri.scheme == registeredUri.scheme &&
        requestedUri.host == registeredUri.host &&
        requestedUri.rawUserInfo == null &&
        requestedUri.rawPath == registeredUri.rawPath &&
        requestedUri.rawQuery == registeredUri.rawQuery &&
        requestedUri.rawFragment == null
}

private fun parseUri(text: String): URI? =
    try {
        URI(text)
    } catch (_: URISyntaxException) {
        null
    }

sealed interface ClientLookup {
    data class Found(val metadata: ClientMetadata) : ClientLookup

    /** [reason] is safe to show: it never holds the fetched body. */
    data class Invalid(val reason: String) : ClientLookup
}

/** Finds the metadata of an OAuth client from its `client_id`, which is an HTTPS URL. */
fun interface ClientMetadataSource {
    fun lookUp(clientId: String): ClientLookup
}

/** The checks on the `client_id` URL and on the document, apart from the fetch. */
internal object ClientMetadataRules {
    private const val MAX_CLIENT_ID_LENGTH = 2048
    private val ipv4Literal = Regex("""[0-9.]+""")

    /** Null when [clientId] may be fetched, or the reason why not. */
    fun clientIdProblem(clientId: String): String? {
        val uri =
            try {
                URI(clientId)
            } catch (_: URISyntaxException) {
                return "The client_id is not a URL."
            }
        return when {
            clientId.length > MAX_CLIENT_ID_LENGTH -> "The client_id is too long."
            uri.scheme != "https" -> "The client_id must be an https URL."
            uri.host.isNullOrEmpty() -> "The client_id has no host."
            // OkHttp connects to an IP literal without the DNS step, so the address policy
            // would not see it.
            uri.host.startsWith("[") || ipv4Literal.matches(uri.host) ->
                "The client_id must use a host name, not an IP address."
            uri.rawUserInfo != null -> "The client_id must not hold a user name or password."
            uri.port != -1 && uri.port !in 1..65535 -> "The client_id has a port that is not valid."
            uri.rawPath.isNullOrEmpty() || uri.rawPath == "/" -> "The client_id must have a path."
            uri.rawFragment != null || uri.rawQuery != null ->
                "The client_id must not have a query or a fragment."
            uri.rawPath.split('/').any { it == "." || it == ".." } ->
                "The client_id must not have dot segments."
            else -> null
        }
    }

    fun parse(clientId: String, body: String): ClientLookup {
        val document =
            try {
                Json.parseToJsonElement(body).jsonObject
            } catch (_: SerializationException) {
                return ClientLookup.Invalid("The client metadata is not a JSON object.")
            } catch (_: IllegalArgumentException) {
                return ClientLookup.Invalid("The client metadata is not a JSON object.")
            }
        val redirectUris =
            (document["redirect_uris"] as? JsonArray)?.map {
                (it as? JsonPrimitive)?.takeIf(JsonPrimitive::isString)?.content
                    ?: return ClientLookup.Invalid("redirect_uris must hold only strings.")
            }
        val authMethod = document.string("token_endpoint_auth_method") ?: "none"
        val clientName = document.string("client_name")?.trim()
        return when {
            document.string("client_id") != clientId ->
                ClientLookup.Invalid("The client_id in the metadata does not match the URL.")
            clientName.isNullOrEmpty() ->
                ClientLookup.Invalid("The client metadata has no client_name.")
            redirectUris.isNullOrEmpty() ->
                ClientLookup.Invalid("The client metadata has no redirect_uris.")
            redirectUris.any { !isAllowedRedirectUri(it) } ->
                ClientLookup.Invalid("Every redirect URI must use https or a localhost address.")
            authMethod != "none" ->
                ClientLookup.Invalid(
                    "Only public clients (token_endpoint_auth_method none) are supported."
                )
            else -> ClientLookup.Found(ClientMetadata(clientId, clientName, redirectUris))
        }
    }

    fun isLoopbackHost(host: String?): Boolean = host in setOf("localhost", "127.0.0.1", "[::1]")

    private fun isAllowedRedirectUri(text: String): Boolean {
        val uri =
            try {
                URI(text)
            } catch (_: URISyntaxException) {
                return false
            }
        return uri.rawFragment == null &&
            !uri.host.isNullOrEmpty() &&
            (uri.scheme == "https" || (uri.scheme == "http" && isLoopbackHost(uri.host)))
    }

    private fun JsonObject.string(name: String): String? =
        (get(name) as? JsonPrimitive)?.takeIf(JsonPrimitive::isString)?.content
}

/** Decides which resolved addresses the server may connect to. */
fun interface AddressPolicy {
    fun allows(address: InetAddress): Boolean

    companion object {
        /** Only public internet addresses: no loopback, private, link-local, or reserved range. */
        val PUBLIC_ONLY = AddressPolicy { address ->
            !(address.isAnyLocalAddress ||
                address.isLoopbackAddress ||
                address.isLinkLocalAddress ||
                address.isSiteLocalAddress ||
                address.isMulticastAddress ||
                isReserved(address))
        }

        private fun isReserved(address: InetAddress): Boolean {
            val bytes = address.address.map { it.toInt() and 0xff }
            return when (address) {
                is Inet4Address ->
                    bytes[0] == 0 ||
                        (bytes[0] == 100 && bytes[1] in 64..127) ||
                        (bytes[0] == 192 && bytes[1] == 0 && bytes[2] == 0) ||
                        (bytes[0] == 198 && bytes[1] in 18..19) ||
                        bytes[0] >= 240
                is Inet6Address ->
                    (bytes[0] and 0xfe) == 0xfc ||
                        (bytes[0] == 0x20 &&
                            bytes[1] == 0x01 &&
                            bytes[2] == 0x0d &&
                            bytes[3] == 0xb8) ||
                        (bytes.subList(0, 4) == listOf(0x00, 0x64, 0xff, 0x9b))
                else -> true
            }
        }
    }
}

/**
 * Fetches Client ID Metadata Documents over HTTPS. The DNS step drops every address that [policy]
 * refuses, and the client connects only to the addresses that remain, so a DNS answer that changes
 * between the check and the connection cannot reach an internal address. The fetch follows no
 * redirect, uses no proxy, and reads at most [MAX_BODY_BYTES].
 */
class HttpClientMetadataSource(
    policy: AddressPolicy = AddressPolicy.PUBLIC_ONLY,
    timeout: Duration = Duration.ofSeconds(5),
    configure: OkHttpClient.Builder.() -> Unit = {},
) : ClientMetadataSource {
    private val client =
        OkHttpClient.Builder()
            .dns(PolicyDns(policy))
            .proxy(Proxy.NO_PROXY)
            .followRedirects(false)
            .followSslRedirects(false)
            .callTimeout(timeout)
            .apply(configure)
            .build()

    override fun lookUp(clientId: String): ClientLookup {
        ClientMetadataRules.clientIdProblem(clientId)?.let {
            return ClientLookup.Invalid(it)
        }
        return try {
            val request =
                Request.Builder().url(clientId).header("Accept", "application/json").build()
            client.newCall(request).execute().use { response ->
                val source = response.body.source()
                when {
                    response.code != 200 ->
                        ClientLookup.Invalid("The client metadata URL answered ${response.code}.")
                    source.request(MAX_BODY_BYTES + 1) ->
                        ClientLookup.Invalid(
                            "The client metadata is larger than $MAX_BODY_BYTES bytes."
                        )
                    else -> ClientMetadataRules.parse(clientId, source.readUtf8())
                }
            }
        } catch (_: BlockedAddressException) {
            ClientLookup.Invalid("The client metadata URL points to an address that is not public.")
        } catch (_: IOException) {
            ClientLookup.Invalid("The client metadata could not be fetched.")
        } catch (_: IllegalArgumentException) {
            ClientLookup.Invalid("The client_id is not a URL that can be fetched.")
        }
    }

    private class BlockedAddressException(host: String) :
        UnknownHostException("$host resolves only to addresses that are not public")

    private class PolicyDns(private val policy: AddressPolicy) : Dns {
        override fun lookup(hostname: String): List<InetAddress> =
            Dns.SYSTEM.lookup(hostname).filter(policy::allows).ifEmpty {
                throw BlockedAddressException(hostname)
            }
    }

    companion object {
        const val MAX_BODY_BYTES = 64L * 1024
    }
}
