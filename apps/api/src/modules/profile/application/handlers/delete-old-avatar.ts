import type { InboxGuard, IntegrationEventHandler, ObjectStorage } from '#/shared/application/ports'
import type { Envelope } from '#/shared/messaging/envelope'
import { type AvatarChangedPayload, ProfileEvents } from '../../contracts/events'

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
    // Xoá object không tồn tại vẫn thành công → idempotent.
    await this.inbox.afterSideEffect(message.id, this.name, () => this.storage.delete(oldKey))
  }
}
