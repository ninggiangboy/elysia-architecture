import type { Email } from './email'
import type { EmailChangeRequest } from './email-change-request'
import type { MagicLink } from './magic-link'
import type { RefreshToken } from './refresh-token'
import type { User } from './user'

export interface UserRepository {
  findById(id: string): Promise<User | null>
  findByEmail(email: Email): Promise<User | null>
  existsByEmail(email: Email): Promise<boolean>
  /** Insert nếu version = 0, ngược lại update có optimistic lock. Email trùng → ConflictError('email_taken'). */
  save(user: User): Promise<void>
}

export interface MagicLinkRepository {
  add(link: MagicLink): Promise<void>
  /** Atomic: đánh dấu đã dùng nếu còn hạn và chưa dùng; trả null nếu không hợp lệ. */
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
   * Atomic: thu hồi token nếu còn hiệu lực (chưa thu hồi, chưa hết hạn) và ghi `replacedById`.
   * Trả token đã thu hồi, hoặc null nếu không hợp lệ.
   */
  consume(tokenHash: string, replacedById: string | null, now: Date): Promise<RefreshToken | null>
  revokeFamily(familyId: string, now: Date): Promise<void>
}
