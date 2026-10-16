import type { Notification } from '../../domain/notification'
import type { NotificationRepository } from '../../domain/notification-repository'

export const DEFAULT_PAGE_SIZE = 20
export const MAX_PAGE_SIZE = 50

export interface NotificationView {
  id: string
  kind: string
  title: string
  body: string
  data: Record<string, unknown>
  read: boolean
  /** > 1 when repeated events were folded into this notification. */
  count: number
  createdAt: string
  readAt: string | null
}

export const toView = (n: Notification): NotificationView => ({
  id: n.id,
  kind: n.props.kind,
  title: n.props.title,
  body: n.props.body,
  data: n.props.data,
  read: n.props.readAt !== null,
  count: n.props.count,
  createdAt: n.props.createdAt.toISOString(),
  readAt: n.props.readAt?.toISOString() ?? null,
})

export interface NotificationPage {
  items: NotificationView[]
  /** Pass as `before` to get the next (older) page; `null` when this was the last one. */
  nextCursor: string | null
}

export class ListNotifications {
  constructor(private notifications: NotificationRepository) {}

  async execute(query: {
    userId: string
    before?: string
    limit?: number
    unreadOnly?: boolean
  }): Promise<NotificationPage> {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE)
    // One extra row tells us whether there is another page, without a count query.
    const rows = await this.notifications.list({
      userId: query.userId,
      before: query.before,
      limit: limit + 1,
      unreadOnly: query.unreadOnly ?? false,
    })
    const items = rows.slice(0, limit).map(toView)
    return { items, nextCursor: rows.length > limit ? (items.at(-1)?.id ?? null) : null }
  }
}

export class GetUnreadCount {
  constructor(private notifications: NotificationRepository) {}

  async execute(query: { userId: string }): Promise<{ count: number }> {
    return { count: await this.notifications.countUnread(query.userId) }
  }
}
