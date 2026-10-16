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
  StepUpCodeRequested: 'identity.step_up_code_requested.v1',
  PasskeyAdded: 'identity.passkey_added.v1',
  PasskeyRemoved: 'identity.passkey_removed.v1',
  OAuthAccountLinked: 'identity.oauth_account_linked.v1',
  OAuthAccountUnlinked: 'identity.oauth_account_unlinked.v1',
  /** Answers to the privacy module's requests (see `privacy/contracts`). */
  DataExported: 'identity.data_exported.v1',
  UserDataErased: 'identity.user_data_erased.v1',
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
  /** How the user proved who they are: `magic_link`, `passkey` or `oauth:<provider>`. Absent on older messages. */
  method?: string
  startedAt: string
}

export type SessionRevokedReason = 'logout' | 'revoked_by_user' | 'token_reuse'

export interface SessionRevokedPayload {
  userId: string
  sessionId: string
  reason: SessionRevokedReason
  revokedAt: string
}

export interface StepUpCodeRequestedPayload {
  userId: string
  email: string
  /** Raw one-time code — lives in the outbox only until it is cleaned up. */
  code: string
  expiresAt: string
}

export interface PasskeyAddedPayload {
  userId: string
  passkeyId: string
  name: string
  addedAt: string
}

export interface PasskeyRemovedPayload {
  userId: string
  passkeyId: string
  name: string
  removedAt: string
}

export interface OAuthAccountLinkedPayload {
  userId: string
  provider: string
  /** Address the provider reported, for display. */
  email: string | null
  linkedAt: string
}

export interface OAuthAccountUnlinkedPayload {
  userId: string
  provider: string
  unlinkedAt: string
}
