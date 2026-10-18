// Per-module migration management:  bun scripts/db.ts generate | migrate
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Database, leftOutModules, migrateModule } from '@kit/db'
import { MODULE_CATALOG, MODULE_NAMES } from '../src/bootstrap/module-catalog'

const command = process.argv[2]

if (command === 'generate') {
  for (const { name, dir } of MODULE_CATALOG) {
    console.log(`\n▶ generate ${name}`)
    // A module is a package and carries its own drizzle.config.ts.
    const proc = Bun.spawn(['bunx', '--bun', 'drizzle-kit', 'generate'], {
      cwd: dir,
      env: process.env,
      stdout: 'inherit',
      stderr: 'inherit',
    })
    if ((await proc.exited) !== 0) process.exit(1)
  }
} else if (command === 'migrate') {
  const env = process.env as Record<string, string | undefined>
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required')
  const database = new Database({ url: env.DATABASE_URL, poolMax: 1, prepare: false })
  try {
    for (const { name, migrations } of MODULE_CATALOG) {
      const folder = migrations
      if (!existsSync(join(folder, 'meta'))) {
        console.warn(`- ${name}: no migrations found, skipping (run db:generate first)`)
        continue
      }
      await migrateModule(database, name, folder)
      console.log(`✔ ${name} migrated`)
    }
    const leftOut = await leftOutModules(database, MODULE_NAMES)
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
