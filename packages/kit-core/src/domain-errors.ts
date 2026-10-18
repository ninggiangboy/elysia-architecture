export type ErrorKind =
  | 'validation'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'too_many_requests'

/** Business error with a stable `code` for clients to handle; `kind` decides the HTTP status in the presentation layer. */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly kind: ErrorKind = 'validation',
  ) {
    super(message)
    this.name = new.target.name
  }
}
