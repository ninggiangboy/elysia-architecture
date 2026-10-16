import type { Email } from './email'
import type { EmailChangeRequest } from './email-change-request'
import type { MagicLink } from './magic-link'
import type { DeviceSession, RefreshToken } from './refresh-token'
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
