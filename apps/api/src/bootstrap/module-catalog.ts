import { outbox as billingOutbox } from '#/modules/billing/infrastructure/persistence/schema'
import { outbox as identityOutbox } from '#/modules/identity/infrastructure/persistence/schema'
import { outbox as notificationOutbox } from '#/modules/notification/infrastructure/persistence/schema'
import { outbox as privacyOutbox } from '#/modules/privacy/infrastructure/persistence/schema'
import { outbox as profileOutbox } from '#/modules/profile/infrastructure/persistence/schema'
import type { OutboxTable } from '#/shared/infrastructure/outbox/tables'

/**
 * The modules, as static data: it builds nothing, so the CLI scripts and drizzle-kit can read it without pulling in the
 * container. Paths are relative to `apps/api`. The order is the order migrations run in.
 */
export interface ModuleEntry {
  readonly name: string
  /** The Drizzle schema file drizzle-kit reads. */
  readonly schemaFile: string
  /** Where the module's generated migrations live. */
  readonly migrations: string
  /** The module's outbox table, or `null` when it emits no events (realtime). */
  readonly outbox: OutboxTable | null
}

const entry = (name: string, outbox: OutboxTable | null): ModuleEntry => ({
  name,
  schemaFile: `src/modules/${name}/infrastructure/persistence/schema.ts`,
  migrations: `src/modules/${name}/migrations`,
  outbox,
})

export const MODULE_CATALOG: readonly ModuleEntry[] = [
  entry('identity', identityOutbox),
  entry('profile', profileOutbox),
  entry('notification', notificationOutbox),
  entry('privacy', privacyOutbox),
  entry('billing', billingOutbox),
  entry('realtime', null),
]

export const MODULE_NAMES = MODULE_CATALOG.map((m) => m.name)

export function moduleEntry(name: string): ModuleEntry {
  const found = MODULE_CATALOG.find((m) => m.name === name)
  if (!found) throw new Error(`Unknown module "${name}" (${MODULE_NAMES.join(' | ')})`)
  return found
}
