import { Elysia } from 'elysia'
import { TooManyRequestsError } from '#/shared/application/errors'
import type { ErrorKind } from '#/shared/domain/errors'
import { DomainError } from '#/shared/domain/errors'
import type { Logger } from '#/shared/infrastructure/logger'
import { requestContext } from '#/shared/infrastructure/request-context'

const STATUS: Record<ErrorKind, number> = {
  validation: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  too_many_requests: 429,
}

function body(code: string, message: string, extra?: Record<string, unknown>) {
  return { error: { code, message, requestId: requestContext.get()?.requestId, ...extra } }
}

export const errorHandlerPlugin = (logger: Logger) =>
  new Elysia({ name: 'error-handler' }).onError({ as: 'global' }, ({ code, error, set }) => {
    if (error instanceof DomainError) {
      set.status = STATUS[error.kind]
      if (error instanceof TooManyRequestsError && error.retryAfterSeconds !== undefined)
        set.headers['retry-after'] = String(error.retryAfterSeconds)
      return body(error.code, error.message)
    }
    switch (code) {
      case 'VALIDATION':
        set.status = 400
        return body('validation_error', 'Invalid request', { details: parseValidation(error) })
      case 'NOT_FOUND':
        set.status = 404
        return body('route_not_found', 'Route not found')
      case 'PARSE':
        set.status = 400
        return body('bad_request', 'Malformed request body')
      default:
        logger.error({ err: error, code }, 'unhandled error')
        set.status = 500
        return body('internal_error', 'Internal server error')
    }
  })

function parseValidation(error: unknown): unknown {
  const message = (error as { message?: string }).message
  if (!message) return undefined
  try {
    const parsed = JSON.parse(message) as { errors?: { path?: string; message?: string }[] }
    return parsed.errors?.map((e) => ({ path: e.path, message: e.message }))
  } catch {
    return message
  }
}
