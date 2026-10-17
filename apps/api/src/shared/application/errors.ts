import { DomainError } from '#/shared/domain/errors'

export { DomainError }

export class NotFoundError extends DomainError {
  constructor(code = 'not_found', message = 'Resource not found') {
    super(code, message, 'not_found')
  }
}

export class ConflictError extends DomainError {
  constructor(code = 'conflict', message = 'Conflict') {
    super(code, message, 'conflict')
  }
}

export class UnauthorizedError extends DomainError {
  constructor(code = 'unauthorized', message = 'Unauthorized') {
    super(code, message, 'unauthorized')
  }
}

export class ForbiddenError extends DomainError {
  constructor(code = 'forbidden', message = 'Forbidden') {
    super(code, message, 'forbidden')
  }
}

export class ValidationError extends DomainError {
  constructor(code = 'validation_error', message = 'Invalid input') {
    super(code, message, 'validation')
  }
}

export class TooManyRequestsError extends DomainError {
  constructor(
    code = 'too_many_requests',
    message = 'Too many requests',
    /** When a retry can succeed, if known; sent as `Retry-After`. */
    readonly retryAfterSeconds?: number,
  ) {
    super(code, message, 'too_many_requests')
  }
}

/** Optimistic lock failed: the aggregate was changed by another request. */
export class VersionConflictError extends ConflictError {
  constructor() {
    super('version_conflict', 'The resource was modified by someone else, please reload')
  }
}
