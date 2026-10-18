import type { Profile } from './profile'

export interface ProfileRepository {
  findByUserId(userId: string): Promise<Profile | null>
  /** Insert (version 0) or update with optimistic lock. */
  save(profile: Profile): Promise<void>
  /** Idempotent: returns false if the profile already exists. */
  createIfAbsent(profile: Profile): Promise<boolean>
}
