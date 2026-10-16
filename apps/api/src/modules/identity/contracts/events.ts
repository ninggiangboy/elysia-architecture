/**
 * Integration events emitted by identity. The payload is a public contract: only add fields (backward compatible);
 * breaking changes need a new version (`.v2`) emitted in parallel for a while.
 */
export const IdentityEvents = {
  MagicLinkRequested: 'identity.magic_link_requested.v1',
  UserRegistered: 'identity.user_registered.v1',
  EmailChangeRequested: 'identity.email_change_requested.v1',
  EmailChanged: 'identity.email_changed.v1',
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
