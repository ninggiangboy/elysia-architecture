import type {
  Clock,
  IdGenerator,
  InboxGuard,
  IntegrationEventHandler,
  OutboxWriter,
} from '#/shared/application/ports'
import type { Envelope } from '#/shared/messaging/envelope'
import { Notification } from '../../domain/notification'
import type { NotificationRepository } from '../../domain/notification-repository'
import type { NotificationDraft } from '../in-app-notifications'
import { notificationCreated } from '../notification-events'

/**
 * Generic handler: integration event → in-app notification.
 * The notification row, the `notification.created` event (which realtime turns into a live push) and the inbox
 * record are written in ONE transaction, so a redelivered event never creates a second notification.
 * `build` returns `null` when the event is not worth a notification. A draft with a `group` is folded into the user's
 * latest unread notification of that group (still one `notification.created`, same id) instead of adding a row.
 */
export class CreateNotificationHandler<TPayload> implements IntegrationEventHandler {
  constructor(
    readonly name: string,
    readonly eventType: string,
    private build: (payload: TPayload) => NotificationDraft | null,
    private notifications: NotificationRepository,
    private outbox: OutboxWriter,
    private inbox: InboxGuard,
    private ids: IdGenerator,
    private clock: Clock,
  ) {}

  async handle(message: Envelope): Promise<void> {
    const draft = this.build(message.payload as unknown as TPayload)
    if (!draft) return
    await this.inbox.transactional(message.id, this.name, async () => {
      if (draft.group) {
        const since = new Date(this.clock.now().getTime() - draft.group.withinMs)
        const folded = await this.notifications.coalesce(draft.userId, draft.group.key, since, {
          title: draft.title,
          body: draft.body,
          data: draft.data ?? {},
        })
        if (folded) {
          // Same id as before: realtime refreshes, and the Web Push `tag` makes the browser replace its notification.
          await this.outbox.add([notificationCreated(folded)])
          return
        }
      }
      const notification = Notification.create({
        id: this.ids.next(),
        userId: draft.userId,
        kind: draft.kind,
        title: draft.title,
        body: draft.body,
        data: draft.data ?? {},
        createdAt: this.clock.now(),
        groupKey: draft.group?.key,
      })
      await this.notifications.insert(notification)
      await this.outbox.add([notificationCreated(notification)])
    })
  }
}
