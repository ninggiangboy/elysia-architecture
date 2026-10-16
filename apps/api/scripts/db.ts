// Per-module migration management:  bun scripts/db.ts generate | migrate
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Database } from '#/shared/infrastructure/db/database'
import { migrateModule } from '#/shared/infrastructure/db/migrate'

const MODULES = ['identity', 'profile', 'notification', 'realtime'] as const
const root = join(import.meta.dir, '..')
const command = process.argv[2]

if (command === 'generate') {
  for (const name of MODULES) {
    console.log(`\n▶ generate ${name}`)
    const proc = Bun.spawn(['bunx', '--bun', 'drizzle-kit', 'generate'], {
      cwd: root,
      env: { ...process.env, MODULE: name },
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
    for (const name of MODULES) {
      const folder = join(root, 'src/modules', name, 'migrations')
      if (!existsSync(join(folder, 'meta'))) {
        console.warn(`- ${name}: no migrations found, skipping (run db:generate first)`)
        continue
      }
      await migrateModule(database, name, folder)
      console.log(`✔ ${name} migrated`)
    }
  } finally {
    await database.close()
  }
} else {
  console.error('Usage: bun scripts/db.ts <generate|migrate>')
  process.exit(1)
}
