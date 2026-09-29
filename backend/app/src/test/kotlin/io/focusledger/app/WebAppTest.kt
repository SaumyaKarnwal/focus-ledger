package io.focusledger.app

import java.nio.file.Files
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

class WebAppTest {
    @Test
    fun withClientId_fillsTheMetaTag() {
        val html = """<head><meta name="google-client-id" content="" /></head>"""

        val filled = WebApp.withClientId(html, "id-1.apps.googleusercontent.com")

        assertEquals(
            """<head><meta name="google-client-id" content="id-1.apps.googleusercontent.com" /></head>""",
            filled,
        )
    }

    @Test
    fun withClientId_escapesTheValue() {
        val html = """<meta name="google-client-id" content="" />"""

        val filled = WebApp.withClientId(html, "a\"><script>")

        assertEquals(
            """<meta name="google-client-id" content="a&quot;&gt;&lt;script&gt;" />""",
            filled,
        )
    }

    @Test
    fun withClientId_withoutTheMetaTag_fails() {
        assertThrows<IllegalStateException> { WebApp.withClientId("<head></head>", "id") }
    }

    @Test
    fun fromDirectory_withoutIndexHtml_isNull() {
        val emptyDir = Files.createTempDirectory("web-empty")

        assertNull(WebApp.fromDirectory(emptyDir, "id"))

        Files.delete(emptyDir)
    }
}
