import type { Clock, UnitOfWork } from '@kit/core'
import { ValidationError } from '@kit/core'
import type { OutboxWriter } from '@kit/messaging'
import type { ObjectStorage } from '@kit/storage'
import type { ProfileRepository } from '../../domain/profile-repository'
import { COVER_CONTENT_TYPES, COVER_MAX_BYTES } from '../../public'
import { isCoverKey } from '../cover-keys'
import { type MeView, toMeView } from '../me-view'
import type { ProfileLoader } from '../profile-loader'

export class SetCover {
  constructor(
    private loader: ProfileLoader,
    private profiles: ProfileRepository,
    private storage: ObjectStorage,
    private outbox: OutboxWriter,
    private uow: UnitOfWork,
    private clock: Clock,
  ) {}

  async execute(cmd: { userId: string; key: string }): Promise<MeView> {
    // The key must be inside the user's own cover "folder" — prevents assigning someone else's (or an avatar) image.
    if (!isCoverKey(cmd.userId, cmd.key) || cmd.key.includes('..')) {
      throw new ValidationError('invalid_cover_key', 'Invalid cover key')
    }
    const stat = await this.storage.stat(cmd.key)
    if (!stat) throw new ValidationError('cover_not_uploaded', 'Cover image was not uploaded')
    if (stat.size > COVER_MAX_BYTES || !(stat.contentType in COVER_CONTENT_TYPES)) {
      // A presigned PUT cannot enforce size/type → check afterwards and clean up invalid files.
      await this.storage.delete(cmd.key)
      throw new ValidationError(
        'invalid_cover',
        'Cover image must be a JPEG, PNG or WebP image up to 5 MB',
      )
    }

    const { account, profile } = await this.loader.load(cmd.userId)
    profile.changeCover(cmd.key, this.clock.now())
    await this.uow.run(async () => {
      await this.profiles.save(profile)
      await this.outbox.add(profile.pullEvents())
    })
    return toMeView(account, profile, this.storage)
  }
}
