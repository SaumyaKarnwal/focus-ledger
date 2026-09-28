package io.focusledger.app

import java.security.SecureRandom
import java.util.Base64

object TestKeys {
    /** A signing key made for this test run: 32 random bytes in base64, 44 characters. */
    fun signingKey(): String =
        Base64.getEncoder().encodeToString(ByteArray(32).also(SecureRandom()::nextBytes))
}
