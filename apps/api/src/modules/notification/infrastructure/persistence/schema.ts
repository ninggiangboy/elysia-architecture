import {
  date,
  doublePrecision,
  integer,
  pgSchema,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'
import { inboxTable } from '#/shared/infrastructure/outbox/tables'

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
