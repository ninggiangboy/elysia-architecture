import { and, eq, isNotNull, or, type SQL } from 'drizzle-orm'
import type { Database } from '#/shared/infrastructure/db/database'
import type { OutboxTable } from './tables'

/**
 * Account erasure: published outbox messages about the user (they keep payloads — names, e-mail addresses — until the
 * relay's retention cleanup) go now. Messages not yet published are left alone: they are still owed to their consumers.
 * `also` widens the match for events that are not keyed by user id (e.g. a payload that carries the e-mail address).
 */
export async function erasePublishedOutbox(
  database: Database,
  table: OutboxTable,
  userId: string,
  also?: SQL,
): Promise<void> {
  const about = also ? or(eq(table.aggregateId, userId), also) : eq(table.aggregateId, userId)
  await database.executor.delete(table).where(and(isNotNull(table.publishedAt), about))
}
