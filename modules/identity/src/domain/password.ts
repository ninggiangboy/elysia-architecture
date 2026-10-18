import { ValidationError } from '@kit/core'

/** argon2id is slow on purpose; past this length the hashing cost becomes a denial-of-service lever. */
const PASSWORD_MAX_LENGTH = 128

export const PASSWORD_RESET_TTL_MS = 30 * 60_000
/** Reset mails one address / one IP may ask for per window. */
export const PASSWORD_RESET_MAX_PER_EMAIL = 3
export const PASSWORD_RESET_MAX_PER_IP = 10
export const PASSWORD_RESET_WINDOW_MS = 15 * 60_000

/** Wrong passwords or sign-in codes tolerated per address / per IP within the window before answering 429. */
export const SIGN_IN_FAILURE_WINDOW_MS = 15 * 60_000
export const SIGN_IN_MAX_FAILURES_PER_EMAIL = 10
export const SIGN_IN_MAX_FAILURES_PER_IP = 50

/**
 * Length is the rule (NIST SP 800-63B): no composition rules, no forced rotation. Counted in code points, so a
 * passphrase in any script is measured the way its owner sees it.
 */
export function assertAcceptablePassword(raw: string, minLength: number): void {
  const length = [...raw].length
  if (length < minLength) {
    throw new ValidationError(
      'password_too_short',
      `Use at least ${minLength} characters for your password`,
    )
  }
  if (length > PASSWORD_MAX_LENGTH) {
    throw new ValidationError(
      'password_too_long',
      `Use at most ${PASSWORD_MAX_LENGTH} characters for your password`,
    )
  }
  if (raw.trim().length === 0) {
    throw new ValidationError('password_too_short', 'A password cannot be only spaces')
  }
}

/** A pending password reset. Only the hash of the mailed token is stored. */
export interface PasswordReset {
  id: string
  userId: string
  email: string
  tokenHash: string
  requestedIp: string
  createdAt: Date
  expiresAt: Date
}
