import type { ConfigSlice } from '@kit/config'
import type { OutboxTable } from '@kit/messaging'
import { billingConfig } from '#/modules/billing/config'
import { outbox as billingOutbox } from '#/modules/billing/infrastructure/persistence/schema'
import { identityConfig } from '#/modules/identity/config'
import { outbox as identityOutbox } from '#/modules/identity/infrastructure/persistence/schema'
import { notificationConfig } from '#/modules/notification/config'
import { outbox as notificationOutbox } from '#/modules/notification/infrastructure/persistence/schema'
import { privacyConfig } from '#/modules/privacy/config'
import { outbox as privacyOutbox } from '#/modules/privacy/infrastructure/persistence/schema'
import { outbox as profileOutbox } from '#/modules/profile/infrastructure/persistence/schema'
import { realtimeConfig } from '#/modules/realtime/config'

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
  /** The module's configuration slice, read under `config.<name>`; absent when it has no variables of its own. */
  readonly config: ConfigSlice | undefined
}

const entry = <const Name extends string, const Slice extends ConfigSlice | undefined>(
  name: Name,
  outbox: OutboxTable | null,
  config?: Slice,
) => ({
  name,
  schemaFile: `src/modules/${name}/infrastructure/persistence/schema.ts`,
  migrations: `src/modules/${name}/migrations`,
  outbox,
  config: config as Slice,
})

// One line per module; removing a module removes its line. (Typed per entry so `Config` knows each slice.)
export const MODULE_CATALOG = [
  entry('identity', identityOutbox, identityConfig),
  entry('profile', profileOutbox),
  entry('notification', notificationOutbox, notificationConfig),
  entry('privacy', privacyOutbox, privacyConfig),
  entry('billing', billingOutbox, billingConfig),
  entry('realtime', null, realtimeConfig),
] as const satisfies readonly ModuleEntry[]

export const MODULE_NAMES: string[] = MODULE_CATALOG.map((m) => m.name)

export function moduleEntry(name: string): ModuleEntry {
  const found = (MODULE_CATALOG as readonly ModuleEntry[]).find((m) => m.name === name)
  if (!found) throw new Error(`Unknown module "${name}" (${MODULE_NAMES.join(' | ')})`)
  return found
}
