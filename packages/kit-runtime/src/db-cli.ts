import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Database, leftOutModules, migrateModule } from '@kit/db'
import type { ModuleManifest } from './app-module'

/**
 * `bun scripts/db.ts generate | migrate` for the modules an app installs. Each module carries its own drizzle config and
 * migrations folder (see its manifest); `migrate` applies them in catalog order and warns about modules that were migrated
 * here once but are not in the catalog now.
 */
export async function runDbCli(catalog: readonly ModuleManifest[], argv = process.argv.slice(2)) {
  const [command] = argv
  if (command === 'generate') {
    for (const { name, dir } of catalog) {
      console.log(`\n▶ generate ${name}`)
      const proc = Bun.spawn(['bunx', '--bun', 'drizzle-kit', 'generate'], {
        cwd: dir,
        env: process.env,
        stdout: 'inherit',
        stderr: 'inherit',
      })
      if ((await proc.exited) !== 0) process.exit(1)
    }
  } else if (command === 'migrate') {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is required')
    const database = new Database({ url, poolMax: 1, prepare: false })
    try {
      for (const { name, migrations } of catalog) {
        if (!existsSync(join(migrations, 'meta'))) {
          console.warn(`- ${name}: no migrations found, skipping (run db:generate first)`)
          continue
        }
        await migrateModule(database, name, migrations)
        console.log(`✔ ${name} migrated`)
      }
      const leftOut = await leftOutModules(
        database,
        catalog.map((m) => m.name),
      )
      if (leftOut.length > 0)
        console.warn(
          `! ${leftOut.join(', ')}: migrated here before, not in the module catalog now (their tables stay as they are)`,
        )
    } finally {
      await database.close()
    }
  } else {
    console.error('Usage: bun scripts/db.ts <generate|migrate>')
    process.exit(1)
  }
}
