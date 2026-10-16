import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
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
import { inboxTable, outboxTable } from '#/shared/infrastructure/outbox/tables'

export const privacySchema = pgSchema('privacy')

/**
 * `user_id` references the identity module's user by value — NO cross-module FK.
 * Only the job is stored here; the exported data itself lives in the bucket.
 */
export const exportRequests = privacySchema.table(
  'export_requests',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    status: text('status').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    readyAt: timestamp('ready_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    archiveKey: text('archive_key'),
    archiveSize: bigint('archive_size', { mode: 'number' }),
    failureReason: text('failure_reason'),
    nudges: integer('nudges').notNull().default(0),
  },
  (t) => [
    index('export_requests_user_idx').on(t.userId, t.requestedAt.desc()),
    // One export in progress per user: the race between two clicks is settled by the database.
    uniqueIndex('export_requests_one_active_idx')
      .on(t.userId)
      .where(sql`${t.status} in ('collecting', 'assembling')`),
    index('export_requests_active_idx')
      .on(t.updatedAt)
      .where(sql`${t.status} in ('collecting', 'assembling')`),
    index('export_requests_expiry_idx').on(t.expiresAt).where(sql`${t.status} = 'ready'`),
  ],
)

export const exportParts = privacySchema.table(
  'export_parts',
  {
    exportId: uuid('export_id')
      .notNull()
      .references(() => exportRequests.id, { onDelete: 'cascade' }),
    module: text('module').notNull(),
    done: boolean('done').notNull(),
    key: text('key'),
    size: bigint('size', { mode: 'number' }).notNull().default(0),
    files: jsonb('files').$type<{ path: string; key: string }[]>().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.exportId, t.module] })],
)

export const accountDeletions = privacySchema.table(
  'account_deletions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    /** Only to say goodbye; null once the deletion is over. */
    email: text('email'),
    status: text('status').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    nudges: integer('nudges').notNull().default(0),
  },
  (t) => [
    index('account_deletions_user_idx').on(t.userId),
    // One deletion in play per user.
    uniqueIndex('account_deletions_one_active_idx')
      .on(t.userId)
      .where(sql`${t.status} in ('scheduled', 'running', 'stalled')`),
    index('account_deletions_due_idx').on(t.scheduledFor).where(sql`${t.status} = 'scheduled'`),
    index('account_deletions_running_idx').on(t.updatedAt).where(sql`${t.status} = 'running'`),
  ],
)

export const deletionSteps = privacySchema.table(
  'deletion_steps',
  {
    deletionId: uuid('deletion_id')
      .notNull()
      .references(() => accountDeletions.id, { onDelete: 'cascade' }),
    module: text('module').notNull(),
    confirmed: boolean('confirmed').notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.deletionId, t.module] })],
)

export const outbox = outboxTable(privacySchema)
export const inbox = inboxTable(privacySchema)
