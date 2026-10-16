/**
 * Integration events emitted by identity. The payload is a public contract: only add fields (backward compatible);
 * breaking changes need a new version (`.v2`) emitted in parallel for a while.
 */
export const IdentityEvents = {
  MagicLinkRequested: 'identity.magic_link_requested.v1',
  UserRegistered: 'identity.user_registered.v1',
  EmailChangeRequested: 'identity.email_change_requested.v1',
  EmailChanged: 'identity.email_changed.v1',
  SessionStarted: 'identity.session_started.v1',
  SessionRevoked: 'identity.session_revoked.v1',
} as const

export interface MagicLinkRequestedPayload {
  email: string
  /** Raw token — lives in the outbox only until it is cleaned up. */
  token: string
  expiresAt: string
}

export interface UserRegisteredPayload {
  userId: string
  email: string
  registeredAt: string
}

export interface EmailChangeRequestedPayload {
  userId: string
  newEmail: string
  token: string
  expiresAt: string
}

export interface EmailChangedPayload {
  userId: string
  oldEmail: string
  newEmail: string
  changedAt: string
}

export interface SessionStartedPayload {
  userId: string
  /** Id of the new login session (the `sid` claim of its access tokens). */
  sessionId: string
  ip: string | null
  userAgent: string | null
  /** True when this sign-in just created the account (the very first session). Absent on older messages = false. */
  newUser?: boolean
  startedAt: string
}

export type SessionRevokedReason = 'logout' | 'revoked_by_user' | 'token_reuse'

export interface SessionRevokedPayload {
  userId: string
  sessionId: string
  reason: SessionRevokedReason
  revokedAt: string
}
