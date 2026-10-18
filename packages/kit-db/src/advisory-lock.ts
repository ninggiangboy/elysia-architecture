import { sql } from 'drizzle-orm'
import type { Database } from './database'

/**
 * Runs `fn` only if the transaction-scoped advisory lock for `key` is free: for jobs that must run on ONE instance at a time.
 * Returns `undefined` when another instance holds the lock. The lock is released when the transaction ends.
 */
export async function withAdvisoryXactLock<T>(
  database: Database,
  key: string,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  return database.run(async () => {
    const rows = await database.executor.execute<{ locked: boolean }>(
      sql`select pg_try_advisory_xact_lock(hashtext(${key})) as locked`,
    )
    if (!rows[0]?.locked) return undefined
    return fn()
  })
}
