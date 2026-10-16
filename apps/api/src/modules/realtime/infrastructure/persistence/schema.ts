import { bigint, index, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const realtimeSchema = pgSchema('realtime')

/**
 * Short replay buffer, not an event store: the last few minutes of each user's events, so a client that reconnects
 * can send `Last-Event-ID` and catch up. `seq` is the SSE event id; it grows in commit order per user
 * (publishers take a per-user advisory lock). `user_id` references the identity module's user by value — NO cross-module FK.
 */
export const events = realtimeSchema.table(
  'events',
  {
    seq: bigint('seq', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    userId: uuid('user_id').notNull(),
    type: text('type').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull(),
    /** Replaying this event also hangs up the connections of that login session (e.g. `session.revoked`). */
    closeSessionId: text('close_session_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('events_user_seq_idx').on(t.userId, t.seq),
    index('events_created_at_idx').on(t.createdAt),
  ],
)
