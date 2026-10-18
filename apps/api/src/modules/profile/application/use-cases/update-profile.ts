import type { Clock } from '@kit/core'
import { VersionConflictError } from '@kit/core'
import type { ObjectStorage } from '#/shared/storage'
import type { ProfileRepository } from '../../domain/profile-repository'
import { type MeView, toMeView } from '../me-view'
import type { ProfileLoader } from '../profile-loader'

export class UpdateProfile {
  constructor(
    private loader: ProfileLoader,
    private profiles: ProfileRepository,
    private storage: ObjectStorage,
    private clock: Clock,
  ) {}

  async execute(cmd: {
    userId: string
    displayName?: string
    bio?: string | null
    expectedVersion?: number
  }): Promise<MeView> {
    const { account, profile } = await this.loader.load(cmd.userId)
    if (cmd.expectedVersion !== undefined && cmd.expectedVersion !== profile.version) {
      throw new VersionConflictError()
    }
    profile.update({ displayName: cmd.displayName, bio: cmd.bio }, this.clock.now())
    await this.profiles.save(profile)
    return toMeView(account, profile, this.storage)
  }
}
