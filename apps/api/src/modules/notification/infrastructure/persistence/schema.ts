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
  uuid,
} from 'drizzle-orm/pg-core'
import { inboxTable, outboxTable } from '#/shared/infrastructure/outbox/tables'

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
    title: text('title').notNull(),
    body: text('body').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => [
    index('notifications_user_idx').on(t.userId, t.id.desc()),
    index('notifications_unread_idx').on(t.userId).where(sql`${t.readAt} is null`),
  ],
)
