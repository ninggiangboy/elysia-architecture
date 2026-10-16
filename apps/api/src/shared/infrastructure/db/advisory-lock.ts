import { sql } from 'drizzle-orm'
import type { ModuleDatabase } from './module-database'

/**
 * Chạy `fn` chỉ khi giành được advisory lock (theo transaction) — dùng cho job chỉ nên chạy ở MỘT instance.
 * Trả về `undefined` nếu instance khác đang giữ lock.
 */
export async function withAdvisoryXactLock<T>(
  mod: ModuleDatabase,
  key: string,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  return mod.run(async () => {
    const rows = await mod.executor.execute<{ locked: boolean }>(
      sql`select pg_try_advisory_xact_lock(hashtext(${key})) as locked`,
    )
    if (!rows[0]?.locked) return undefined
    return fn()
  })
}
