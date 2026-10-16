export type ErrorKind =
  | 'validation'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'too_many_requests'

/** Lỗi nghiệp vụ có mã ổn định (`code`) để client xử lý; `kind` quyết định HTTP status ở tầng presentation. */
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
