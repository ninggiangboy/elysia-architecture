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
  SignupVerificationRequested: 'identity.signup_verification_requested.v1',
  SignupExistingAccount: 'identity.signup_existing_account.v1',
  PasswordResetRequested: 'identity.password_reset_requested.v1',
  PasswordChanged: 'identity.password_changed.v1',
  TwoFactorEnabled: 'identity.two_factor_enabled.v1',
  TwoFactorDisabled: 'identity.two_factor_disabled.v1',
  InvitationSent: 'identity.invitation_sent.v1',
  /** Answers to the privacy module's requests (see `privacy/contracts`). */
  DataExported: 'identity.data_exported.v1',
  UserDataErased: 'identity.user_data_erased.v1',
} as const

export interface MagicLinkRequestedPayload {
  email: string
  /** Language of the page that asked for the link; the mail is written in it. Absent on older messages = default. */
  locale?: string
  /** Raw token — lives in the outbox only until it is cleaned up. */
  token: string
  /** The same sign-in as a 6-digit code (raw, like `token`). Absent on older messages. */
  code?: string
  expiresAt: string
}

export interface UserRegisteredPayload {
  userId: string
  email: string
  /** The account's language at sign-up. Absent on older messages = default. */
  locale?: string
  /** The name the person chose at sign-up (or their provider's). Absent = none given. */
  displayName?: string
  /** How the email was proven: `magic_link`, `email_code`, `password`, `oauth:<provider>`. Absent on older messages. */
  method?: string
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
  /**
   * How the user proved who they are: `magic_link`, `email_code`, `password`, `passkey` or `oauth:<provider>`.
   * Absent on older messages.
   */
  method?: string
  /** The second factor, when one was asked for: `totp` or `recovery_code`. */
  secondFactor?: string
  startedAt: string
}

export type SessionRevokedReason = 'logout' | 'revoked_by_user' | 'token_reuse' | 'password_changed'

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

export interface SignupVerificationRequestedPayload {
  email: string
  locale?: string
  /** Raw token and code — live in the outbox only until it is cleaned up. */
  token: string
  code: string
  expiresAt: string
}

/** Someone tried to sign up with an address that already has an account: its owner is told, the requester is not. */
export interface SignupExistingAccountPayload {
  userId: string
  email: string
  requestedAt: string
}

export interface PasswordResetRequestedPayload {
  userId: string
  email: string
  /** Raw token — lives in the outbox only until it is cleaned up. */
  token: string
  expiresAt: string
}

export interface PasswordChangedPayload {
  userId: string
  /** The account's address, for the notice mail. Absent on older messages. */
  email?: string
  change: 'set' | 'changed' | 'removed' | 'reset'
  changedAt: string
}

export interface TwoFactorEnabledPayload {
  userId: string
  enabledAt: string
}

export interface TwoFactorDisabledPayload {
  userId: string
  disabledAt: string
}

export interface InvitationSentPayload {
  invitationId: string
  email: string
  invitedBy: string | null
  /** The inviter's address, for the mail ("x invited you"). */
  inviterEmail: string | null
  expiresAt: string
}
