import type { ProfileApi } from '../../contracts/profile-api'
import type { ProfileRepository } from '../../domain/profile-repository'

/** Implementation of the ProfileApi contract (in-process). */
export class ProfileApiImpl implements ProfileApi {
  constructor(private profiles: ProfileRepository) {}

  async getDisplayName(userId: string): Promise<string | null> {
    return (await this.profiles.findByUserId(userId))?.displayName ?? null
  }
}
