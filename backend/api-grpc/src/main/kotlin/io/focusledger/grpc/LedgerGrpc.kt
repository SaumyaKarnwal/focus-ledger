package io.focusledger.grpc

import com.linecorp.armeria.common.grpc.GrpcSerializationFormats
import com.linecorp.armeria.server.grpc.GrpcService
import io.focusledger.core.UserId
import io.focusledger.core.account.AccountService
import io.focusledger.core.ledger.LedgerService

/** The entry points that the app module wires into Armeria. */
object LedgerGrpc {
    /** LedgerService for gRPC and gRPC-Web (docs/architecture.md, "Server stack"). */
    fun service(
        ledger: LedgerService,
        account: AccountService,
        cookies: SessionCookies,
    ): GrpcService =
        GrpcService.builder()
            .addService(LedgerGrpcService(ledger, account, cookies))
            .intercept(SessionInterceptor(cookies))
            .supportedSerializationFormats(GrpcSerializationFormats.values())
            .build()

    /**
     * The signed-in user for a Cookie header. The OAuth consent in api-mcp uses it through the app.
     */
    fun browserUser(cookies: SessionCookies, cookieHeader: String?): UserId? =
        cookies.read(cookieHeader)?.userId
}
