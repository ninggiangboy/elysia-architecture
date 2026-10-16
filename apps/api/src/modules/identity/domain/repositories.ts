import type { Email } from './email'
import type { EmailChangeRequest } from './email-change-request'
import type { MagicLink } from './magic-link'
import type { RefreshToken } from './refresh-token'
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
  revokeFamily(familyId: string, now: Date): Promise<void>
}
