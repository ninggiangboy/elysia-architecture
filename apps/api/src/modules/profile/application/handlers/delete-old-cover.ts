import type { Envelope, InboxGuard, IntegrationEventHandler } from '@kit/messaging'
import type { ObjectStorage } from '#/shared/storage'
import { type CoverChangedPayload, ProfileEvents } from '../../contracts/events'

export class DeleteOldCover implements IntegrationEventHandler {
  readonly name = 'profile.delete-old-cover'
  readonly eventType = ProfileEvents.CoverChanged

  constructor(
    private storage: ObjectStorage,
    private inbox: InboxGuard,
  ) {}

  async handle(message: Envelope): Promise<void> {
    const { oldKey } = message.payload as unknown as CoverChangedPayload
    if (!oldKey) return
    // Deleting a non-existent object still succeeds → idempotent.
    await this.inbox.afterSideEffect(message.id, this.name, () => this.storage.delete(oldKey))
  }
}
