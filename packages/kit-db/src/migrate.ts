import { sql } from 'drizzle-orm'
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

/** The modules that have a migration history in the database (the `drizzle_<module>` schemas). */
export async function migratedModules(database: Database): Promise<string[]> {
  const rows = await database.db.execute<{ schema_name: string }>(
    sql`select schema_name from information_schema.schemata where schema_name like 'drizzle\_%' order by schema_name`,
  )
  return rows.map((r) => r.schema_name.slice('drizzle_'.length))
}

/**
 * Modules that were migrated here once but are not in `installed` now. Not an error — leaving a module out of an app is
 * allowed, its tables just stay — but worth a warning: it is usually a module removed from the wiring by mistake.
 */
export async function leftOutModules(
  database: Database,
  installed: readonly string[],
): Promise<string[]> {
  return (await migratedModules(database)).filter((m) => !installed.includes(m))
}
