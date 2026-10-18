import { AVATAR_CONTENT_TYPES, AVATAR_MAX_BYTES } from '@app/shared-types/profile'
import type { Clock, UnitOfWork } from '#/shared/core'
import { ValidationError } from '#/shared/core'
import type { OutboxWriter } from '#/shared/messaging'
import type { ObjectStorage } from '#/shared/storage'
import type { ProfileRepository } from '../../domain/profile-repository'
import { isCoverKey } from '../cover-keys'
import { type MeView, toMeView } from '../me-view'
import type { ProfileLoader } from '../profile-loader'

export class SetAvatar {
  constructor(
    private loader: ProfileLoader,
    private profiles: ProfileRepository,
    private storage: ObjectStorage,
    private outbox: OutboxWriter,
    private uow: UnitOfWork,
    private clock: Clock,
  ) {}

  async execute(cmd: { userId: string; key: string }): Promise<MeView> {
    // The key must be inside the user's own "folder" — prevents assigning someone else's image.
    if (
      !cmd.key.startsWith(`${cmd.userId}/`) ||
      isCoverKey(cmd.userId, cmd.key) ||
      cmd.key.includes('..')
    ) {
      throw new ValidationError('invalid_avatar_key', 'Invalid avatar key')
    }
    const stat = await this.storage.stat(cmd.key)
    if (!stat) throw new ValidationError('avatar_not_uploaded', 'Avatar file was not uploaded')
    if (stat.size > AVATAR_MAX_BYTES || !(stat.contentType in AVATAR_CONTENT_TYPES)) {
      // A presigned PUT cannot enforce size/type → check afterwards and clean up invalid files.
      await this.storage.delete(cmd.key)
      throw new ValidationError(
        'invalid_avatar',
        'Avatar must be a JPEG, PNG or WebP image up to 2 MB',
      )
    }

    const { account, profile } = await this.loader.load(cmd.userId)
    profile.changeAvatar(cmd.key, this.clock.now())
    await this.uow.run(async () => {
      await this.profiles.save(profile)
      await this.outbox.add(profile.pullEvents())
    })
    return toMeView(account, profile, this.storage)
  }
}
