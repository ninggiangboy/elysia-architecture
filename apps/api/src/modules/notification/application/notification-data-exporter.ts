import type { DataExporter, ExportedPart } from '#/shared/application/privacy'
import type { Notification } from '../domain/notification'
import type { NotificationRepository } from '../domain/notification-repository'
import type { PushSubscriptionRepository } from '../domain/push-subscription-repository'

const PAGE = 200

/** What notification holds about a user, for a data export: every notification, and which browsers get pushes. */
export class NotificationDataExporter implements DataExporter {
  constructor(
    private notifications: NotificationRepository,
    private pushSubscriptions: PushSubscriptionRepository,
  ) {}

  async collect(userId: string): Promise<ExportedPart> {
    const items: Notification[] = []
    for (let before: string | undefined; ; ) {
      const page = await this.notifications.list({ userId, before, limit: PAGE, unreadOnly: false })
      items.push(...page)
      if (page.length < PAGE) break
      before = page[page.length - 1]?.id
    }
    const [seenAt, subscriptions] = await Promise.all([
      this.notifications.lastSeenAt(userId),
      this.pushSubscriptions.listByUser(userId),
    ])
    return {
      data: {
        notifications: items.map((n) => ({
          kind: n.props.kind,
          title: n.props.title,
          body: n.props.body,
          data: n.props.data,
          createdAt: n.props.createdAt.toISOString(),
          readAt: n.props.readAt?.toISOString() ?? null,
        })),
        notificationListLastOpenedAt: seenAt?.toISOString() ?? null,
        // The push endpoint and keys are credentials to send to a browser, not data about the person: left out.
        pushSubscriptions: subscriptions.map((s) => ({
          userAgent: s.props.userAgent,
          subscribedAt: s.props.createdAt.toISOString(),
        })),
      },
    }
  }
}
