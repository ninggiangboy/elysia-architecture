import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  jsonb,
  type PgSchema,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

/** The outbox table lives in the schema of the module that emits events. */
export function outboxTable(schema: PgSchema) {
  return schema.table(
    'outbox_messages',
    {
      id: uuid('id').primaryKey(),
      type: text('type').notNull(),
      aggregateId: text('aggregate_id').notNull(),
      payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
      headers: jsonb('headers').$type<Record<string, string>>().notNull(),
      occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
      attempts: integer('attempts').notNull().default(0),
      nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
      lockedUntil: timestamp('locked_until', { withTimezone: true }),
      publishedAt: timestamp('published_at', { withTimezone: true }),
      deadAt: timestamp('dead_at', { withTimezone: true }),
      lastError: text('last_error'),
    },
    (t) => [
      index('outbox_pending_idx')
        .on(t.nextAttemptAt)
        .where(sql`${t.publishedAt} is null and ${t.deadAt} is null`),
    ],
  )
}

/** The inbox table lives in the schema of the module that consumes events — ensures each (message, handler) is processed once. */
export function inboxTable(schema: PgSchema) {
  return schema.table(
    'inbox',
    {
      messageId: uuid('message_id').notNull(),
      handler: text('handler').notNull(),
      processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [primaryKey({ columns: [t.messageId, t.handler] })],
  )
}

export type OutboxTable = ReturnType<typeof outboxTable>
export type InboxTable = ReturnType<typeof inboxTable>
