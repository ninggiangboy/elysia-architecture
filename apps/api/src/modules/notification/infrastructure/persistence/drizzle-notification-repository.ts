import { and, count, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm'
import type { Database } from '#/shared/infrastructure/db/database'
import {
  Notification,
  type NotificationKind,
  type NotificationProps,
} from '../../domain/notification'
import type { ListQuery, NotificationRepository } from '../../domain/notification-repository'
import { notifications } from './schema'

export class DrizzleNotificationRepository implements NotificationRepository {
  constructor(private database: Database) {}

  async insert(notification: Notification): Promise<void> {
    const p = notification.props
    await this.database.executor.insert(notifications).values({
      id: p.id,
      userId: p.userId,
      kind: p.kind,
      title: p.title,
      body: p.body,
      data: p.data,
      createdAt: p.createdAt,
      readAt: p.readAt,
      groupKey: p.groupKey,
      count: p.count,
    })
  }

  async coalesce(
    userId: string,
    groupKey: string,
    since: Date,
    latest: Pick<NotificationProps, 'title' | 'body' | 'data'>,
  ): Promise<Notification | null> {
    const target = this.database.executor
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.groupKey, groupKey),
          isNull(notifications.readAt),
          gte(notifications.createdAt, since),
        ),
      )
      .orderBy(desc(notifications.id))
      .limit(1)
      .for('update', { skipLocked: true })
    const [row] = await this.database.executor
      .update(notifications)
      .set({
        count: sql`${notifications.count} + 1`,
        title: latest.title,
        body: latest.body,
        data: latest.data,
      })
      .where(eq(notifications.id, sql`(${target})`))
      .returning()
    return row ? Notification.restore({ ...row, kind: row.kind as NotificationKind }) : null
  }

  async list(query: ListQuery): Promise<Notification[]> {
    const rows = await this.database.executor
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, query.userId),
          query.before ? lt(notifications.id, query.before) : undefined,
          query.unreadOnly ? isNull(notifications.readAt) : undefined,
        ),
      )
      .orderBy(desc(notifications.id))
      .limit(query.limit)
    return rows.map((row) => Notification.restore({ ...row, kind: row.kind as NotificationKind }))
  }

  async countUnread(userId: string): Promise<number> {
    const [row] = await this.database.executor
      .select({ value: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
    return row?.value ?? 0
  }

  async markRead(userId: string, id: string, now: Date) {
    const ex = this.database.executor
    const updated = await ex
      .update(notifications)
      .set({ readAt: now })
      .where(
        and(
          eq(notifications.id, id),
          eq(notifications.userId, userId),
          isNull(notifications.readAt),
        ),
      )
      .returning({ id: notifications.id })
    if (updated.length > 0) return 'marked' as const
    const [existing] = await ex
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
      .limit(1)
    return existing ? ('already_read' as const) : ('not_found' as const)
  }

  async markAllRead(userId: string, now: Date): Promise<number> {
    const updated = await this.database.executor
      .update(notifications)
      .set({ readAt: now })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
      .returning({ id: notifications.id })
    return updated.length
  }
}
