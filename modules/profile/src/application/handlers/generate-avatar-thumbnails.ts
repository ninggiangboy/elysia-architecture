import type { Log } from '@kit/core'
import type { Envelope, InboxGuard, IntegrationEventHandler } from '@kit/messaging'
import type { ObjectStorage } from '@kit/storage'
import { type AvatarChangedPayload, ProfileEvents } from '../../contracts/events'
import { AVATAR_THUMBNAIL_SIZES, avatarThumbnailKey } from '../avatar-thumbnails'
import { type ImageResizer, UnprocessableImageError } from '../ports'

/**
 * Heavy, so it belongs on a worker (`APP_ROLES=worker`). Idempotent twice over: the inbox skips a message already
 * handled, and a thumbnail that already exists is left alone, so a redelivery after a lease expiry costs nothing.
 */
export class GenerateAvatarThumbnails implements IntegrationEventHandler {
  readonly name = 'profile.generate-avatar-thumbnails'
  readonly eventType = ProfileEvents.AvatarChanged

  constructor(
    private storage: ObjectStorage,
    private resizer: ImageResizer,
    private inbox: InboxGuard,
    private log: Log,
  ) {}

  async handle(message: Envelope): Promise<void> {
    const { newKey } = message.payload as unknown as AvatarChangedPayload
    await this.inbox.afterSideEffect(message.id, this.name, () => this.generate(newKey))
  }

  private async generate(avatarKey: string): Promise<void> {
    const missing: number[] = []
    for (const size of AVATAR_THUMBNAIL_SIZES) {
      if (!(await this.storage.stat(avatarThumbnailKey(avatarKey, size)))) missing.push(size)
    }
    if (missing.length === 0) return

    const source = await this.storage.read(avatarKey)
    if (!source) return // replaced and cleaned up before this ran; nothing left to thumbnail
    try {
      for (const size of missing) {
        const thumb = await this.resizer.square(source, size)
        await this.storage.write(avatarThumbnailKey(avatarKey, size), thumb.data, thumb.contentType)
      }
    } catch (err) {
      if (!(err instanceof UnprocessableImageError)) throw err
      // Retrying a corrupt upload would only fill the dead-letter queue; the original avatar still works.
      this.log.warn(
        { err, key: avatarKey },
        'avatar is not a processable image, no thumbnails made',
      )
    }
  }
}
