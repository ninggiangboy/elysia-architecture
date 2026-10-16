import type { Profile } from './profile'

export interface ProfileRepository {
  findByUserId(userId: string): Promise<Profile | null>
  /** Insert (version 0) hoặc update có optimistic lock. */
  save(profile: Profile): Promise<void>
  /** Idempotent: trả false nếu profile đã tồn tại. */
  createIfAbsent(profile: Profile): Promise<boolean>
}
