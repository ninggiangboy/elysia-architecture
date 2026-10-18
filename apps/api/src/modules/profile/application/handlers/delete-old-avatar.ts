import type { Envelope, InboxGuard, IntegrationEventHandler } from '@kit/messaging'
import type { ObjectStorage } from '#/shared/storage'
import { type AvatarChangedPayload, ProfileEvents } from '../../contracts/events'
import { avatarThumbnailKeys } from '../avatar-thumbnails'

export class DeleteOldAvatar implements IntegrationEventHandler {
  readonly name = 'profile.delete-old-avatar'
  readonly eventType = ProfileEvents.AvatarChanged

  constructor(
    private storage: ObjectStorage,
    private inbox: InboxGuard,
  ) {}

  async handle(message: Envelope): Promise<void> {
    const { oldKey } = message.payload as unknown as AvatarChangedPayload
    if (!oldKey) return
    // Deleting a non-existent object still succeeds → idempotent (and thumbnails may never have been made).
    await this.inbox.afterSideEffect(message.id, this.name, async () => {
      await Promise.all(
        [oldKey, ...avatarThumbnailKeys(oldKey)].map((key) => this.storage.delete(key)),
      )
    })
  }
}
