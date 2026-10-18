import type { OAuthState, WebAuthnChallenge, WebAuthnPurpose } from './auth-challenge'
import type { Email } from './email'
import type { EmailChangeRequest } from './email-change-request'
import type { Invitation } from './invitation'
import type { MagicLink } from './magic-link'
import type { OAuthAccount, OAuthProviderId } from './oauth-account'
import type { Passkey } from './passkey'
import type { PasswordReset } from './password'
import type { DeviceSession, RefreshToken } from './refresh-token'
import type { Signup } from './signup'
import type { StepUpCode } from './step-up-code'
import type { MfaChallenge, TotpCredential } from './two-factor'
import type { User } from './user'

/** How many requests a scope made inside a window, and when the oldest of them was made (for `Retry-After`). */
export interface WindowCount {
  count: number
  oldest: Date | null
}

/** Throttles count rows per address or per IP. */
export type ThrottleScope = { email: string } | { ip: string }

export interface UserRepository {
  findById(id: string): Promise<User | null>
  findByEmail(email: Email): Promise<User | null>
  existsByEmail(email: Email): Promise<boolean>
  /** Insert if version = 0, otherwise update with optimistic lock. Duplicate email → ConflictError('email_taken'). */
  save(user: User): Promise<void>
}

export interface MagicLinkRepository {
  add(link: MagicLink): Promise<void>
  /** Atomic: mark as used if still valid and unused; returns null if invalid. */
  consume(tokenHash: string, now: Date): Promise<MagicLink | null>
  /**
   * Atomic: consumes a live link of `email` whose code hash matches and that took fewer than `maxAttempts` wrong codes.
   * On a mismatch every live link of that address counts the attempt, and null is returned.
   */
  consumeByCode(
    email: Email,
    codeHash: string,
    now: Date,
    maxAttempts: number,
  ): Promise<MagicLink | null>
}

export interface SignupRepository {
  /** Also deletes rows that expired long ago (anyone can start a sign-up). */
  add(signup: Signup): Promise<void>
  /** Atomic and single-use: the signup if the token matches, unused and unexpired. */
  consume(tokenHash: string, now: Date): Promise<Signup | null>
  /** Same shape as `MagicLinkRepository.consumeByCode`, for unverified (password) sign-ups. */
  consumeByCode(
    email: Email,
    codeHash: string,
    now: Date,
    maxAttempts: number,
  ): Promise<Signup | null>
  /** Unverified sign-ups started by the scope since `since` (each one sent a mail). */
  startedSince(scope: ThrottleScope, since: Date): Promise<WindowCount>
}

export interface PasswordResetRepository {
  /** Earlier pending resets of the user stop working: only the newest mail counts. */
  issue(reset: PasswordReset): Promise<void>
  consume(tokenHash: string, now: Date): Promise<PasswordReset | null>
  requestedSince(scope: ThrottleScope, since: Date): Promise<WindowCount>
}

export interface SignInFailureRepository {
  record(failure: {
    id: string
    email: string
    ip: string
    method: string
    at: Date
  }): Promise<void>
  since(scope: ThrottleScope, since: Date): Promise<WindowCount>
}

export interface TotpCredentialRepository {
  find(userId: string): Promise<TotpCredential | null>
  /** Replaces a pending (unconfirmed) enrolment; never a confirmed one (ConflictError('totp_already_enabled')). */
  savePending(credential: TotpCredential): Promise<void>
  /** Confirmation / last used step, with an optimistic lock (VersionConflictError): one code, one sign-in. */
  saveUse(credential: TotpCredential): Promise<void>
  remove(userId: string): Promise<boolean>
}

export interface RecoveryCodeRepository {
  /** Drops the user's previous codes and stores these. */
  replace(userId: string, codeHashes: string[], now: Date): Promise<void>
  /** Atomic and single-use. */
  consume(userId: string, codeHash: string, now: Date): Promise<boolean>
  remaining(userId: string): Promise<number>
  removeAll(userId: string): Promise<void>
}

export interface MfaChallengeRepository {
  add(challenge: MfaChallenge): Promise<void>
  /** The challenge if unused, unexpired and under `maxAttempts` wrong codes. */
  findLive(tokenHash: string, now: Date, maxAttempts: number): Promise<MfaChallenge | null>
  recordFailure(id: string): Promise<void>
  /** Atomic: false when another request consumed it first. */
  consume(id: string, now: Date): Promise<boolean>
}

export interface InvitationRepository {
  add(invitation: Invitation): Promise<void>
  hasPending(email: Email, now: Date): Promise<boolean>
  /** Marks the pending invitations of `email` accepted (the account now exists). */
  accept(email: Email, now: Date): Promise<void>
  /** Newest first. */
  listByInviter(userId: string): Promise<Invitation[]>
  sentSince(userId: string, since: Date): Promise<WindowCount>
  /** Scoped to the inviter; false when they have no pending invitation with this id. */
  revoke(userId: string, id: string, now: Date): Promise<boolean>
}

export interface EmailChangeRequestRepository {
  add(request: EmailChangeRequest): Promise<void>
  consume(tokenHash: string, now: Date): Promise<EmailChangeRequest | null>
}

export interface RefreshTokenRepository {
  add(token: RefreshToken): Promise<void>
  findByHash(tokenHash: string): Promise<RefreshToken | null>
  /**
   * Atomic: revokes the token if still valid (not revoked, not expired) and records `replacedById`.
   * Returns the revoked token, or null if invalid.
   */
  consume(tokenHash: string, replacedById: string | null, now: Date): Promise<RefreshToken | null>
  /** Sessions of the user that still have a live refresh token, most recently active first. */
  listActiveSessions(userId: string, now: Date): Promise<DeviceSession[]>
  /** Revokes the whole family (all its tokens), scoped to the owner. Returns false if the user has no live session with this id. */
  revokeUserSession(userId: string, familyId: string, now: Date): Promise<boolean>
  /** Revokes every live session of the user except `exceptFamilyId`; returns the ids of the sessions ended. */
  revokeOtherSessions(userId: string, exceptFamilyId: string, now: Date): Promise<string[]>
  /** Revokes every live session of the user (password reset); returns the ids of the sessions ended. */
  revokeAllSessions(userId: string, now: Date): Promise<string[]>
}

export interface PasskeyRepository {
  /** Duplicate credential id → ConflictError('passkey_exists'). */
  add(passkey: Passkey): Promise<void>
  findByCredentialId(credentialId: string): Promise<Passkey | null>
  findByUserAndId(userId: string, id: string): Promise<Passkey | null>
  /** Oldest first. */
  listByUser(userId: string): Promise<Passkey[]>
  /** Updates counter / backup state / last use with an optimistic lock (VersionConflictError). */
  saveUse(passkey: Passkey): Promise<void>
  /** Scoped to the owner; returns false when the user has no such passkey. */
  remove(userId: string, id: string): Promise<boolean>
}

export interface WebAuthnChallengeRepository {
  add(challenge: WebAuthnChallenge): Promise<void>
  /** Atomic and single-use: returns the challenge only if it is unused, unexpired and made for `purpose`. */
  consume(id: string, purpose: WebAuthnPurpose, now: Date): Promise<WebAuthnChallenge | null>
}

export interface OAuthAccountRepository {
  /** Duplicate (provider, provider user) or (user, provider) → ConflictError('oauth_account_taken'). */
  add(account: OAuthAccount): Promise<void>
  findByProviderUser(
    provider: OAuthProviderId,
    providerUserId: string,
  ): Promise<OAuthAccount | null>
  listByUser(userId: string): Promise<OAuthAccount[]>
  /** Scoped to the owner; returns false when the user has not linked that provider. */
  remove(userId: string, provider: OAuthProviderId): Promise<boolean>
}

export interface OAuthStateRepository {
  add(state: OAuthState): Promise<void>
  /** Atomic and single-use: returns the state only if it is unused and unexpired. */
  consume(stateHash: string, now: Date): Promise<OAuthState | null>
}

export interface StepUpCodeRepository {
  /** Replaces any code still pending for the user: only the newest one can be used. */
  issue(code: StepUpCode): Promise<void>
  /** Codes issued to the user since `since`, and when the oldest of them was issued. */
  issuedSince(userId: string, since: Date): Promise<{ count: number; oldest: Date | null }>
  /**
   * Consumes the user's pending code if `codeHash` matches and fewer than `maxAttempts` wrong guesses were made.
   * On a mismatch it counts the attempt and returns false.
   */
  verify(userId: string, codeHash: string, now: Date, maxAttempts: number): Promise<boolean>
}
