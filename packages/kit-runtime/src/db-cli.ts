import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Database, leftOutModules, migrateModule } from '@kit/db'
import type { ModuleManifest } from './app-module'

const say = (line: string) => process.stdout.write(`${line}\n`)
const warn = (line: string) => process.stderr.write(`${line}\n`)

async function generate(catalog: readonly ModuleManifest[]) {
  for (const { name, dir } of catalog) {
    say(`\n▶ generate ${name}`)
    const proc = Bun.spawn(['bunx', '--bun', 'drizzle-kit', 'generate'], {
      cwd: dir,
      env: process.env,
      stdout: 'inherit',
      stderr: 'inherit',
    })
    if ((await proc.exited) !== 0) process.exit(1)
  }
}

async function migrate(catalog: readonly ModuleManifest[]) {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required')
  const database = new Database({ url, poolMax: 1, prepare: false })
  try {
    for (const { name, migrations } of catalog) {
      if (!existsSync(join(migrations, 'meta'))) {
        warn(`- ${name}: no migrations found, skipping (run db:generate first)`)
        continue
      }
      await migrateModule(database, name, migrations)
      say(`✔ ${name} migrated`)
    }
    const leftOut = await leftOutModules(
      database,
      catalog.map((m) => m.name),
    )
    if (leftOut.length > 0)
      warn(
        `! ${leftOut.join(', ')}: migrated here before, not in the module catalog now (their tables stay as they are)`,
      )
  } finally {
    await database.close()
  }
}

/**
 * `bun scripts/db.ts generate | migrate` for the modules an app installs. Each module carries its own drizzle config and
 * migrations folder (see its manifest); `migrate` applies them in catalog order and warns about modules that were migrated
 * here once but are not in the catalog now.
 */
export async function runDbCli(catalog: readonly ModuleManifest[], argv = process.argv.slice(2)) {
  const [command] = argv
  if (command === 'generate') return generate(catalog)
  if (command === 'migrate') return migrate(catalog)
  warn('Usage: bun scripts/db.ts <generate|migrate>')
  process.exit(1)
}
