import { and, count, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm'
import type { Database } from '#/shared/infrastructure/db/database'
import {
  Notification,
  type NotificationKind,
  type NotificationProps,
} from '../../domain/notification'
import type { ListQuery, NotificationRepository } from '../../domain/notification-repository'
import { inboxState, notifications } from './schema'

export class DrizzleNotificationRepository implements NotificationRepository {
  constructor(private database: Database) {}

  async insert(notification: Notification): Promise<void> {
    const p = notification.props
    await this.database.executor.insert(notifications).values({
      id: p.id,
      userId: p.userId,
      kind: p.kind,
      template: p.template,
      title: p.title,
      body: p.body,
      data: p.data,
      createdAt: p.createdAt,
      notifiedAt: p.notifiedAt,
      readAt: p.readAt,
      groupKey: p.groupKey,
      count: p.count,
    })
  }

  async lockGroup(userId: string, groupKey: string): Promise<void> {
    // Waits (unlike the try-lock jobs use) because the loser must then see the winner's row; hashtext collisions only cost a wait.
    await this.database.executor.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`notification-group:${userId}:${groupKey}`}))`,
    )
  }

  async coalesce(
    userId: string,
    groupKey: string,
    since: Date,
    now: Date,
    latest: Pick<NotificationProps, 'template' | 'title' | 'body' | 'data'>,
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
        notifiedAt: now,
        template: latest.template,
        title: latest.title,
        body: latest.body,
        data: latest.data,
      })
      .where(eq(notifications.id, sql`(${target})`))
      .returning()
    return row ? Notification.restore({ ...row, kind: row.kind as NotificationKind }) : null
  }

  async createdAtBefore(userId: string, id: string): Promise<Date | null> {
    const [row] = await this.database.executor
      .select({ createdAt: notifications.createdAt })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), lt(notifications.id, id)))
      .orderBy(desc(notifications.id))
      .limit(1)
    return row?.createdAt ?? null
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

  async countUnseen(userId: string): Promise<number> {
    const seenAt = this.database.executor
      .select({ at: inboxState.seenAt })
      .from(inboxState)
      .where(eq(inboxState.userId, userId))
    const [row] = await this.database.executor
      .select({ value: count() })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          isNull(notifications.readAt),
          sql`${notifications.notifiedAt} > coalesce((${seenAt}), '-infinity'::timestamptz)`,
        ),
      )
    return row?.value ?? 0
  }

  async lastSeenAt(userId: string): Promise<Date | null> {
    const [row] = await this.database.executor
      .select({ at: inboxState.seenAt })
      .from(inboxState)
      .where(eq(inboxState.userId, userId))
    return row?.at ?? null
  }

  async markSeen(userId: string, now: Date): Promise<void> {
    await this.database.executor
      .insert(inboxState)
      .values({ userId, seenAt: now })
      .onConflictDoUpdate({
        target: inboxState.userId,
        set: { seenAt: sql`greatest(${inboxState.seenAt}, excluded.seen_at)` },
      })
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

  async deleteCreatedBefore(cutoff: Date, limit: number): Promise<number> {
    // SKIP LOCKED: two instances pruning at once take different rows instead of waiting for each other.
    const batch = this.database.executor
      .select({ id: notifications.id })
      .from(notifications)
      .where(lt(notifications.createdAt, cutoff))
      .orderBy(notifications.createdAt)
      .limit(limit)
      .for('update', { skipLocked: true })
    const deleted = await this.database.executor
      .delete(notifications)
      .where(inArray(notifications.id, batch))
      .returning({ id: notifications.id })
    return deleted.length
  }
}
