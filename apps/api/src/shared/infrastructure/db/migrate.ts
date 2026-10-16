import { migrate } from 'drizzle-orm/postgres-js/migrator'
import type { ModuleDatabase } from './module-database'

/** Mỗi module có thư mục migration và bảng lịch sử migration riêng (`drizzle_<module>`). */
export async function migrateModule(mod: ModuleDatabase, migrationsFolder: string): Promise<void> {
  await migrate(mod.db, {
    migrationsFolder,
    migrationsSchema: `drizzle_${mod.name}`,
    migrationsTable: '__migrations',
  })
}
