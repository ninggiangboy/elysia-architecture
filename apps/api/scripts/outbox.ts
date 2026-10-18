// Outbox dead-letter operations:
//   bun scripts/outbox.ts list
//   bun scripts/outbox.ts requeue [--module <name>] [--type <event type>] [--id <uuid>]
// A handler that already finished a message is blocked by the inbox, so requeue does not send duplicates; only unfinished handlers run again.

import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { MODULE_CATALOG, MODULE_NAMES } from '#/bootstrap/module-catalog'
import { Database } from '#/shared/db'

const SOURCES = MODULE_CATALOG.flatMap((m) => (m.outbox ? [{ name: m.name, table: m.outbox }] : []))

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
  console.error(
    `Usage: bun scripts/outbox.ts <list|requeue> [--module ${MODULE_NAMES.join('|')}] [--type t] [--id uuid]`,
  )
  process.exit(1)
}

let total = 0
const database = new Database({ url: env.DATABASE_URL, poolMax: 1, prepare: false })
try {
  for (const { name, table } of SOURCES) {
    if (onlyModule && onlyModule !== name) continue
    const dead = and(
      isNotNull(table.deadAt),
      type ? eq(table.type, type) : undefined,
      id ? eq(table.id, id) : undefined,
    )
    if (command === 'list') {
      const rows = await database.db
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
      const rows = await database.db
        .update(table)
        .set({
          deadAt: null,
          attempts: 0,
          lockedUntil: null,
          lastError: null,
          nextAttemptAt: sql`now()`,
        })
        .where(dead)
        .returning({ id: table.id })
      total += rows.length
    }
  }
} finally {
  await database.close()
}
console.log(command === 'list' ? `${total} dead message(s)` : `${total} message(s) requeued`)
