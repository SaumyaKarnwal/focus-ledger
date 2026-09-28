package io.focusledger.grpc

import com.linecorp.armeria.common.HttpHeaderNames
import com.linecorp.armeria.server.ServiceRequestContext
import focusledger.v1.LedgerServiceGrpc
import io.focusledger.core.UserId
import io.grpc.Context
import io.grpc.Contexts
import io.grpc.Metadata
import io.grpc.ServerCall
import io.grpc.ServerCallHandler
import io.grpc.ServerInterceptor
import io.grpc.Status

/**
 * Turns the session cookie into the [UserId] before any handler runs (rule 1). A call with no valid
 * session gets UNAUTHENTICATED, except the two calls that work without one. A cookie older than a
 * day gets a fresh 30-day cookie on the response.
 */
internal class SessionInterceptor(private val cookies: SessionCookies) : ServerInterceptor {

    override fun <Req, Resp> interceptCall(
        call: ServerCall<Req, Resp>,
        headers: Metadata,
        next: ServerCallHandler<Req, Resp>,
    ): ServerCall.Listener<Req> {
        val requestContext = ServiceRequestContext.current()
        val session = cookies.read(headers.get(COOKIE))
        val method = call.methodDescriptor.fullMethodName
        if (session == null && method !in OPEN_METHODS) {
            call.close(Status.UNAUTHENTICATED.withDescription("Sign in first."), Metadata())
            return object : ServerCall.Listener<Req>() {}
        }
        if (session?.shouldRenew == true) {
            requestContext.addAdditionalResponseHeader(
                HttpHeaderNames.SET_COOKIE,
                cookies.issue(session.userId),
            )
        }
        val context =
            Context.current()
                .withValue(USER_ID, session?.userId)
                .withValue(REQUEST_CONTEXT, requestContext)
        return Contexts.interceptCall(context, call, headers, next)
    }

    companion object {
        val USER_ID: Context.Key<UserId?> = Context.key("focusledger-user-id")
        val REQUEST_CONTEXT: Context.Key<ServiceRequestContext> =
            Context.key("focusledger-request-context")

        private val COOKIE: Metadata.Key<String> =
            Metadata.Key.of("cookie", Metadata.ASCII_STRING_MARSHALLER)

        private val OPEN_METHODS =
            setOf(
                LedgerServiceGrpc.getSignInMethod().fullMethodName,
                LedgerServiceGrpc.getSignOutMethod().fullMethodName,
            )
    }
}
