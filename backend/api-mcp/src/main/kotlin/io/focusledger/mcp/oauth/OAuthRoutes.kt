package io.focusledger.mcp.oauth

import io.focusledger.mcp.MCP_PATH
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.Parameters
import io.ktor.server.application.Application
import io.ktor.server.application.ApplicationCall
import io.ktor.server.request.header
import io.ktor.server.request.receiveParameters
import io.ktor.server.request.uri
import io.ktor.server.response.header
import io.ktor.server.response.respondRedirect
import io.ktor.server.response.respondText
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.routing
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** The OAuth endpoints and the two metadata documents. Armeria forwards these paths to Ktor. */
fun Application.ledgerOAuth(oauth: OAuthServer) {
    routing {
        // RFC 9728: MCP clients try the path of the resource first, then the root.
        get(OAuthConfig.PROTECTED_RESOURCE_METADATA_PATH + MCP_PATH) {
            call.respondJson(oauth.protectedResourceMetadata())
        }
        get(OAuthConfig.PROTECTED_RESOURCE_METADATA_PATH) {
            call.respondJson(oauth.protectedResourceMetadata())
        }
        get(OAuthConfig.AUTHORIZATION_SERVER_METADATA_PATH) {
            call.respondJson(oauth.authorizationServerMetadata())
        }
        get(OAuthConfig.AUTHORIZE_PATH) {
            val parameters = call.request.queryParameters.singleValues()
            val check =
                parameters?.let(oauth::checkAuthorization)
                    ?: AuthorizationCheck.ShowError(REPEATED_PARAMETER)
            when (check) {
                is AuthorizationCheck.ShowError ->
                    call.respondPage(Pages.error(check.message), HttpStatusCode.BadRequest)
                is AuthorizationCheck.Redirect -> call.respondRedirect(check.url)
                is AuthorizationCheck.Valid -> {
                    val userId = oauth.sessions.userId(call.request.header(HttpHeaders.Cookie))
                    if (userId == null) {
                        call.respondRedirect(oauth.config.signInUrl(call.request.uri))
                    } else {
                        call.respondPage(
                            Pages.consent(check.request, oauth.consentToken(userId, check.request))
                        )
                    }
                }
            }
        }
        post(OAuthConfig.AUTHORIZE_PATH) {
            val form = call.receiveParameters()
            val userId = oauth.sessions.userId(call.request.header(HttpHeaders.Cookie))
            val decision =
                if (userId == null) {
                    AuthorizationCheck.ShowError(
                        "You are not signed in. Start the connection again from the agent."
                    )
                } else {
                    oauth.decide(userId, form["consent"], approved = form["decision"] == "approve")
                }
            when (decision) {
                is AuthorizationCheck.Redirect -> call.respondRedirect(decision.url)
                is AuthorizationCheck.ShowError ->
                    call.respondPage(Pages.error(decision.message), HttpStatusCode.BadRequest)
                is AuthorizationCheck.Valid -> error("A decision never asks for consent again.")
            }
        }
        post(OAuthConfig.TOKEN_PATH) {
            call.response.header(HttpHeaders.CacheControl, "no-store")
            call.response.header(HttpHeaders.Pragma, "no-cache")
            val parameters = call.receiveParameters().singleValues()
            val result =
                parameters?.let(oauth::token)
                    ?: TokenResult.Failed("invalid_request", REPEATED_PARAMETER)
            when (result) {
                is TokenResult.Issued -> call.respondJson(result.body)
                is TokenResult.Failed ->
                    call.respondJson(
                        buildJsonObject {
                            put("error", result.error)
                            put("error_description", result.description)
                        },
                        HttpStatusCode.BadRequest,
                    )
            }
        }
    }
}

private const val REPEATED_PARAMETER = "A request parameter appears more than once."

/** One value per name, or null when a name repeats, which OAuth rejects (RFC 6749, 3.1). */
private fun Parameters.singleValues(): Map<String, String>? =
    entries().map { (name, values) -> name to (values.singleOrNull() ?: return null) }.toMap()

private suspend fun ApplicationCall.respondJson(
    body: JsonObject,
    status: HttpStatusCode = HttpStatusCode.OK,
) = respondText(body.toString(), ContentType.Application.Json, status)

private suspend fun ApplicationCall.respondPage(
    html: String,
    status: HttpStatusCode = HttpStatusCode.OK,
) {
    Pages.headers.forEach { (name, value) -> response.header(name, value) }
    respondText(html, ContentType.Text.Html, status)
}
