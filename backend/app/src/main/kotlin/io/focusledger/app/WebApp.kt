package io.focusledger.app

import com.linecorp.armeria.common.HttpData
import com.linecorp.armeria.common.HttpHeaderNames
import com.linecorp.armeria.common.HttpMethod
import com.linecorp.armeria.common.HttpRequest
import com.linecorp.armeria.common.HttpResponse
import com.linecorp.armeria.common.HttpStatus
import com.linecorp.armeria.common.MediaType
import com.linecorp.armeria.common.ResponseHeaders
import com.linecorp.armeria.server.HttpService
import com.linecorp.armeria.server.ServiceRequestContext
import com.linecorp.armeria.server.file.FileService
import java.nio.file.Files
import java.nio.file.Path

/**
 * Serves the web build. A GET for a path with no file returns `index.html`, so the browser app
 * handles its own routes. Armeria gives the gRPC and forwarded routes to other services first.
 */
class WebApp private constructor(private val files: FileService, private val indexHtml: String) :
    HttpService {
    private val filesOrIndex: HttpService = files.orElse { _, req -> index(req) }

    override fun serve(ctx: ServiceRequestContext, req: HttpRequest): HttpResponse =
        when {
            // The file service would send index.html without the client ID.
            ctx.path() == "/" || ctx.path() == "/$INDEX_FILE" -> index(req)
            ctx.path().startsWith("/.well-known/") -> files.serve(ctx, req)
            else -> filesOrIndex.serve(ctx, req)
        }

    private fun index(req: HttpRequest): HttpResponse =
        if (req.method() == HttpMethod.GET || req.method() == HttpMethod.HEAD) {
            HttpResponse.of(
                ResponseHeaders.builder(HttpStatus.OK)
                    .contentType(MediaType.HTML_UTF_8)
                    .add(HttpHeaderNames.CACHE_CONTROL, "no-cache")
                    .build(),
                HttpData.ofUtf8(indexHtml),
            )
        } else {
            HttpResponse.of(HttpStatus.NOT_FOUND)
        }

    companion object {
        private const val INDEX_FILE = "index.html"
        private val clientIdTag = Regex("""<meta name="google-client-id" content="[^"]*"""")

        /** Returns null when [dir] holds no `index.html`, for example in a local run. */
        fun fromDirectory(dir: Path, googleClientId: String): WebApp? {
            val indexFile = dir.resolve(INDEX_FILE)
            if (!Files.isRegularFile(indexFile)) return null
            return WebApp(
                FileService.of(dir),
                withClientId(Files.readString(indexFile), googleClientId),
            )
        }

        internal fun withClientId(html: String, googleClientId: String): String {
            check(clientIdTag.containsMatchIn(html)) {
                "$INDEX_FILE has no google-client-id meta tag."
            }
            val tag = """<meta name="google-client-id" content="${escapeHtml(googleClientId)}""""
            return clientIdTag.replace(html) { tag }
        }

        private fun escapeHtml(text: String): String =
            text
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&#39;")
    }
}
