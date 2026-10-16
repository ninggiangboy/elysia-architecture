import type { OAuthState, WebAuthnChallenge, WebAuthnPurpose } from './auth-challenge'
import type { Email } from './email'
import type { EmailChangeRequest } from './email-change-request'
import type { MagicLink } from './magic-link'
import type { OAuthAccount, OAuthProviderId } from './oauth-account'
import type { Passkey } from './passkey'
import type { DeviceSession, RefreshToken } from './refresh-token'
import type { StepUpCode } from './step-up-code'
import type { User } from './user'

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
  countSince(userId: string, since: Date): Promise<number>
  /**
   * Consumes the user's pending code if `codeHash` matches and fewer than `maxAttempts` wrong guesses were made.
   * On a mismatch it counts the attempt and returns false.
   */
  verify(userId: string, codeHash: string, now: Date, maxAttempts: number): Promise<boolean>
}
