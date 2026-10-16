import { migrate } from 'drizzle-orm/postgres-js/migrator'
import type { Database } from './database'

/** Each module has its own migration folder and migration history table (`drizzle_<module>`). */
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
