// Quản lý migration theo từng module:  bun scripts/db.ts generate | migrate
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { databaseUrlFor, type ModuleName } from '#/shared/infrastructure/config'
import { migrateModule } from '#/shared/infrastructure/db/migrate'
import { ModuleDatabase } from '#/shared/infrastructure/db/module-database'

const MODULES: ModuleName[] = ['identity', 'profile', 'notification']
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
  for (const name of MODULES) {
    const folder = join(root, 'src/modules', name, 'migrations')
    if (!existsSync(join(folder, 'meta'))) {
      console.warn(`- ${name}: no migrations found, skipping (run db:generate first)`)
      continue
    }
    const mod = new ModuleDatabase(name, {
      url: databaseUrlFor(
        {
          DATABASE_URL: env.DATABASE_URL,
          IDENTITY_DATABASE_URL: env.IDENTITY_DATABASE_URL,
          PROFILE_DATABASE_URL: env.PROFILE_DATABASE_URL,
          NOTIFICATION_DATABASE_URL: env.NOTIFICATION_DATABASE_URL,
        },
        name,
      ),
      poolMax: 1,
      prepare: false,
    })
    try {
      await migrateModule(mod, folder)
      console.log(`✔ ${name} migrated`)
    } finally {
      await mod.close()
    }
  }
} else {
  console.error('Usage: bun scripts/db.ts <generate|migrate>')
  process.exit(1)
}
