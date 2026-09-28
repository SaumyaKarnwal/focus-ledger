package io.focusledger.core

/** The limits from docs/schema.md. The database checks them again. */
internal object Limits {
    const val NAME_LENGTH = 200
    val CYCLE_MINUTES = 1..1440
    val MODE_MINUTES = 1..480
    val BREAK_MINUTES = 1..60
}

internal fun invalid(field: String, reason: String): ServiceResult.Failure =
    ServiceResult.Failure(ServiceError.InvalidArgument(field, reason))

internal fun notFound(resource: ServiceError.Resource, field: String): ServiceResult.Failure =
    ServiceResult.Failure(ServiceError.NotFound(resource, field))

internal fun failedPrecondition(rule: ServiceError.Rule): ServiceResult.Failure =
    ServiceResult.Failure(ServiceError.FailedPrecondition(rule))

/** The first failure from [checks], or null when every check passes. */
internal fun firstFailure(vararg checks: () -> ServiceResult.Failure?): ServiceResult.Failure? =
    checks.firstNotNullOfOrNull {
        it()
    }

internal fun checkRange(field: String, value: Int, range: IntRange): ServiceResult.Failure? =
    if (value in range) null else invalid(field, "must be from ${range.first} to ${range.last}")

internal inline fun <T, R> ServiceResult<T>.map(transform: (T) -> R): ServiceResult<R> =
    when (this) {
        is ServiceResult.Success -> ServiceResult.Success(transform(value))
        is ServiceResult.Failure -> this
    }

internal inline fun <T, R> ServiceResult<T>.flatMap(
    transform: (T) -> ServiceResult<R>
): ServiceResult<R> =
    when (this) {
        is ServiceResult.Success -> transform(value)
        is ServiceResult.Failure -> this
    }
