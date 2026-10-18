import { DomainError, UnauthorizedError } from '@kit/core'

/** How long the client may take to type the second factor after the first one succeeded. */
export const MFA_CHALLENGE_TTL_MS = 5 * 60_000
export const MFA_MAX_ATTEMPTS = 5
export const RECOVERY_CODE_COUNT = 10

/** The authenticator app of a user. Its secret is stored encrypted; the domain only sees the plaintext in memory. */
export class TotpCredential {
  constructor(
    readonly userId: string,
    readonly secret: string,
    private _confirmedAt: Date | null,
    private _lastUsedStep: number | null,
    public version: number,
    readonly createdAt: Date,
  ) {}

  get confirmed(): boolean {
    return this._confirmedAt !== null
  }

  get confirmedAt(): Date | null {
    return this._confirmedAt
  }

  get lastUsedStep(): number | null {
    return this._lastUsedStep
  }

  static pending(params: { userId: string; secret: string; now: Date }): TotpCredential {
    return new TotpCredential(params.userId, params.secret, null, null, 0, params.now)
  }

  /** The first correct code turns a pending enrolment on. */
  confirm(step: number, now: Date): void {
    if (this.confirmed) throw new DomainError('totp_already_enabled', 'Two-factor is already on')
    this._confirmedAt = now
    this._lastUsedStep = step
  }

  /** A code is valid for its 30-second step only once, even inside its validity window (RFC 6238 §5.2). */
  recordUse(step: number): void {
    if (this._lastUsedStep !== null && step <= this._lastUsedStep) {
      throw new UnauthorizedError(
        'invalid_mfa_code',
        'This code was already used, wait for the next',
      )
    }
    this._lastUsedStep = step
  }
}

/** First factor done, second pending. Only the hash of the token the client holds is stored. */
export interface MfaChallenge {
  id: string
  tokenHash: string
  userId: string
  /** The first factor, for `session_started`: `password`, `magic_link`, `email_code`, `oauth:<provider>`. */
  method: string
  createdAt: Date
  expiresAt: Date
}

/** `xxxxx-xxxxx` from an alphabet without look-alikes (no 0/o, 1/l/i): 31^10 ≈ 2^49. */
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

/** `pick(n)` must return a uniform integer in [0, n) (`randomInt`), so no character is likelier than another. */
export function newRecoveryCode(pick: (n: number) => number): string {
  const chars = Array.from({ length: 10 }, () => RECOVERY_ALPHABET[pick(RECOVERY_ALPHABET.length)])
  return `${chars.slice(0, 5).join('')}-${chars.slice(5).join('')}`
}

/** What the user typed, in the form the hash was taken of: lowercase, dash restored, spaces dropped. */
export function normalizeRecoveryCode(raw: string): string {
  const compact = raw.toLowerCase().replace(/[\s-]/g, '')
  return compact.length === 10 ? `${compact.slice(0, 5)}-${compact.slice(5)}` : compact
}

/** A 6-digit authenticator code, or a recovery code. */
export const looksLikeTotpCode = (raw: string) => /^\d{6}$/.test(raw.replace(/\s/g, ''))
