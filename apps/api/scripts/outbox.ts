// Vận hành dead-letter của outbox:
//   bun scripts/outbox.ts list
//   bun scripts/outbox.ts requeue [--module identity|profile] [--type <event type>] [--id <uuid>]
// Handler đã xử lý xong một message sẽ bị inbox chặn nên requeue không gửi trùng; chỉ handler còn dở mới chạy lại.
import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { outbox as identityOutbox } from '#/modules/identity/infrastructure/persistence/schema'
import { outbox as profileOutbox } from '#/modules/profile/infrastructure/persistence/schema'
import { databaseUrlFor, type ModuleName } from '#/shared/infrastructure/config'
import { ModuleDatabase } from '#/shared/infrastructure/db/module-database'
import type { OutboxTable } from '#/shared/infrastructure/outbox/tables'

const SOURCES: { name: ModuleName; table: OutboxTable }[] = [
  { name: 'identity', table: identityOutbox },
  { name: 'profile', table: profileOutbox },
]

const env = process.env as Record<string, string | undefined>
if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required')

const [command, ...rest] = process.argv.slice(2)
const flag = (name: string) => {
  const i = rest.indexOf(`--${name}`)
  return i >= 0 ? rest[i + 1] : undefined
}
const onlyModule = flag('module')
const type = flag('type')
const id = flag('id')

if (command !== 'list' && command !== 'requeue') {
  console.error('Usage: bun scripts/outbox.ts <list|requeue> [--module m] [--type t] [--id uuid]')
  process.exit(1)
}

let total = 0
for (const { name, table } of SOURCES) {
  if (onlyModule && onlyModule !== name) continue
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
    const dead = and(
      isNotNull(table.deadAt),
      type ? eq(table.type, type) : undefined,
      id ? eq(table.id, id) : undefined,
    )
    if (command === 'list') {
      const rows = await mod.db
        .select({
          id: table.id,
          type: table.type,
          attempts: table.attempts,
          deadAt: table.deadAt,
          lastError: table.lastError,
        })
        .from(table)
        .where(dead)
      for (const r of rows) {
        console.log(
          `${name}\t${r.id}\t${r.type}\tattempts=${r.attempts}\t${r.deadAt?.toISOString()}\t${r.lastError ?? ''}`,
        )
      }
      total += rows.length
    } else {
      const rows = await mod.db
        .update(table)
        .set({ deadAt: null, attempts: 0, lockedUntil: null, nextAttemptAt: sql`now()` })
        .where(dead)
        .returning({ id: table.id })
      total += rows.length
    }
  } finally {
    await mod.close()
  }
}
console.log(command === 'list' ? `${total} dead message(s)` : `${total} message(s) requeued`)
