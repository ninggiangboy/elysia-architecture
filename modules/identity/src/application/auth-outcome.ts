import type { SessionTokens } from './session-issuer'

/** Where a sign-in stands after the first proof: done, waiting for a second factor, or waiting for a sign-up form. */
export type AuthOutcome =
  | {
      kind: 'session'
      user: { id: string; email: string }
      session: SessionTokens
      newUser: boolean
    }
  | { kind: 'mfa_required'; mfaToken: string; expiresAt: Date }
  | {
      kind: 'signup_required'
      signupToken: string
      email: string
      suggestedName: string | null
      termsVersion: string
    }

export type SessionOutcome = Extract<AuthOutcome, { kind: 'session' }>

/** A session that was started (or refreshed) for a user. */
export interface SessionResult {
  user: { id: string; email: string }
  session: SessionTokens
}
