/** A proven email waiting for the person to finish the sign-up form (name, terms). */
export const SIGNUP_TTL_MS = 30 * 60_000
/** A password sign-up waiting for the email to be verified. */
export const SIGNUP_VERIFICATION_TTL_MS = 24 * 60 * 60_000
export const SIGNUP_CODE_MAX_ATTEMPTS = 5
/** Password sign-ups one address / one IP may start per window (each sends a mail). */
export const SIGNUP_MAX_PER_EMAIL = 3
export const SIGNUP_MAX_PER_IP = 10
export const SIGNUP_WINDOW_MS = 15 * 60_000

/**
 * An account being created. With `emailProvenAt` set, the person proved the address (link, code, provider) and is
 * choosing a name and accepting the terms; without it, they signed up with a password and must verify the address
 * first. Either way the `users` row is written only at the end.
 */
export interface Signup {
  id: string
  email: string
  tokenHash: string
  codeHash: string | null
  emailProvenAt: Date | null
  /** `magic_link`, `email_code`, `oauth:<provider>` or `password`. */
  method: string
  passwordHash: string | null
  displayName: string | null
  termsVersion: string | null
  locale: string
  /** The provider identity to link once the account exists (sign-up through OAuth). */
  oauth: { provider: string; providerUserId: string; email: string | null } | null
  requestedIp: string | null
  createdAt: Date
  expiresAt: Date
}

const MAX_DISPLAY_NAME_LENGTH = 50

/** Trimmed, collapsed whitespace, capped; empty → null (the profile then derives a name from the email). */
export function normalizeDisplayName(raw: string | null | undefined): string | null {
  const value = (raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_DISPLAY_NAME_LENGTH)
  return value || null
}
