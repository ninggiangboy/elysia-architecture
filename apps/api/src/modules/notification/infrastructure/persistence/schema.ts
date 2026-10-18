import { inboxTable, outboxTable } from '@kit/messaging'
import { sql } from 'drizzle-orm'
import {
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

export const notificationSchema = pgSchema('notification')

export const inbox = inboxTable(notificationSchema)

/** Token bucket shared by all instances: limits the mail send rate (mails/second). */
export const rateBuckets = notificationSchema.table('rate_buckets', {
  key: text('key').primaryKey(),
  tokens: doublePrecision('tokens').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
})

/** Daily quota counter (UTC). */
export const mailQuota = notificationSchema.table(
  'mail_quota',
  {
    key: text('key').notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    sent: integer('sent').notNull(),
  },
  (t) => [primaryKey({ columns: [t.key, t.day] })],
)

export const outbox = outboxTable(notificationSchema)

/** `user_id` references the identity module's user by value — NO cross-module FK. Ids are UUIDv7, so id order = creation order. */
export const notifications = notificationSchema.table(
  'notifications',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    kind: text('kind').notNull(),
    /** The client's message template for this notification; `null` = custom, `title`/`body` hold the text. */
    template: text('template'),
    title: text('title').notNull(),
    body: text('body').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    /** Last time this notification made news: `createdAt`, bumped when a repeat is folded into it. Drives the badge. */
    notifiedAt: timestamp('notified_at', { withTimezone: true }).notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
    groupKey: text('group_key'),
    count: integer('count').notNull().default(1),
  },
  (t) => [
    index('notifications_user_idx').on(t.userId, t.id.desc()),
    index('notifications_created_idx').on(t.createdAt),
    index('notifications_unread_idx').on(t.userId).where(sql`${t.readAt} is null`),
    index('notifications_group_idx')
      .on(t.userId, t.groupKey, t.id.desc())
      .where(sql`${t.readAt} is null and ${t.groupKey} is not null`),
  ],
)

/** When the user last opened the notification list: what arrived after is "unseen" (the badge), whether read or not. */
export const inboxState = notificationSchema.table('inbox_state', {
  userId: uuid('user_id').primaryKey(),
  seenAt: timestamp('seen_at', { withTimezone: true }).notNull(),
})

/** One browser of a user that agreed to Web Push. `endpoint` identifies the browser, so it is unique across users. */
export const pushSubscriptions = notificationSchema.table(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    /** The login session (`sid`) that registered it: when that session ends, so does the subscription. */
    sessionId: uuid('session_id').notNull(),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('push_subscriptions_endpoint_idx').on(t.endpoint),
    index('push_subscriptions_user_idx').on(t.userId),
  ],
)
