import { migrate } from 'drizzle-orm/postgres-js/migrator'
import type { Database } from './database'

/** Mỗi module có thư mục migration và bảng lịch sử migration riêng (`drizzle_<module>`). */
export async function migrateModule(
  database: Database,
  module: string,
  migrationsFolder: string,
): Promise<void> {
  await migrate(database.db, {
    migrationsFolder,
    migrationsSchema: `drizzle_${module}`,
    migrationsTable: '__migrations',
  })
}
