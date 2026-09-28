package io.focusledger.mcp.oauth

import java.net.URI

/** The product name on the pages that this server renders. The brand name is not final. */
const val PRODUCT_NAME = "Ekagra"

/** The consent and error pages. Every value that comes from a client or a request is escaped. */
internal object Pages {
    fun consent(request: AuthorizationRequest, consentToken: String): String {
        val redirectHost = URI(request.redirectUri).host
        val clientHost = URI(request.client.clientId).host
        val localWarning =
            if (ClientMetadataRules.isLoopbackHost(redirectHost)) {
                "<p class=\"warn\">This app receives the approval on your own computer " +
                    "(${html(redirectHost)}). Approve only if you started this connection yourself " +
                    "just now.</p>"
            } else {
                ""
            }
        return page(
            "Connect ${request.client.clientName}",
            """
            <h1>Connect ${html(request.client.clientName)} to ${html(PRODUCT_NAME)}?</h1>
            <p>${html(request.client.clientName)} (from ${html(clientHost)}) asks to read and change
            your work log: nodes, estimates, and cycles.</p>
            <p>After you answer, your browser returns to <strong>${html(redirectHost)}</strong>.</p>
            $localWarning
            <form method="post" action="${OAuthConfig.AUTHORIZE_PATH}">
              <input type="hidden" name="consent" value="${html(consentToken)}">
              <button type="submit" name="decision" value="approve">Approve</button>
              <button type="submit" name="decision" value="deny">Deny</button>
            </form>
            """,
        )
    }

    fun error(message: String): String =
        page("Cannot connect", "<h1>The agent cannot connect</h1><p>${html(message)}</p>")

    /** The response headers for every page: no framing, no caching, no referrer. */
    val headers =
        mapOf(
            "Content-Security-Policy" to
                "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
            "X-Frame-Options" to "DENY",
            "Cache-Control" to "no-store",
            "Referrer-Policy" to "no-referrer",
        )

    fun html(text: String): String = buildString {
        text.forEach { character ->
            when (character) {
                '&' -> append("&amp;")
                '<' -> append("&lt;")
                '>' -> append("&gt;")
                '"' -> append("&quot;")
                '\'' -> append("&#39;")
                else -> append(character)
            }
        }
    }

    private fun page(title: String, body: String) =
        """
        <!doctype html>
        <html lang="en"><head><meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>${html(title)} · ${html(PRODUCT_NAME)}</title>
        <style>
          body { font-family: system-ui, sans-serif; max-width: 32rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.5; }
          .warn { background: #fff4d6; padding: 0.75rem; border-radius: 0.5rem; }
          button { font-size: 1rem; padding: 0.5rem 1.25rem; margin-right: 0.5rem; }
        </style></head>
        <body>$body</body></html>
        """
            .trimIndent()
}
