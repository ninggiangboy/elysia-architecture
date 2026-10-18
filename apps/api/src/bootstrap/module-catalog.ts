import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ConfigSlice } from '@kit/config'
import type { OutboxTable } from '@kit/messaging'
import { realtimeManifest } from '@mod/realtime/manifest'
import { billingConfig } from '#/modules/billing/config'
import { outbox as billingOutbox } from '#/modules/billing/infrastructure/persistence/schema'
import { identityConfig } from '#/modules/identity/config'
import { outbox as identityOutbox } from '#/modules/identity/infrastructure/persistence/schema'
import { notificationConfig } from '#/modules/notification/config'
import { outbox as notificationOutbox } from '#/modules/notification/infrastructure/persistence/schema'
import { privacyConfig } from '#/modules/privacy/config'
import { outbox as privacyOutbox } from '#/modules/privacy/infrastructure/persistence/schema'
import { outbox as profileOutbox } from '#/modules/profile/infrastructure/persistence/schema'

/**
 * The modules, as static data: it builds nothing, so the CLI scripts and drizzle-kit can read it without pulling in the
 * container. Paths are relative to `apps/api`. The order is the order migrations run in.
 */
export interface ModuleEntry {
  readonly name: string
  /** Absolute path of the Drizzle schema file drizzle-kit reads. */
  readonly schemaFile: string
  /** Absolute path of the folder with the module's generated migrations. */
  readonly migrations: string
  /** The folder holding the module's own `drizzle.config.ts`; absent for a module that still uses the app's. */
  readonly dir?: string
  /** The module's outbox table, or `null` when it emits no events (realtime). */
  readonly outbox: OutboxTable | null
  /** The module's configuration slice, read under `config.<name>`; absent when it has no variables of its own. */
  readonly config: ConfigSlice | undefined
}

const API_ROOT = fileURLToPath(new URL('../..', import.meta.url))

const entry = <const Name extends string, const Slice extends ConfigSlice | undefined>(
  name: Name,
  outbox: OutboxTable | null,
  config?: Slice,
) => ({
  name,
  schemaFile: join(API_ROOT, `src/modules/${name}/infrastructure/persistence/schema.ts`),
  migrations: join(API_ROOT, `src/modules/${name}/migrations`),
  dir: undefined,
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
  realtimeManifest,
] as const satisfies readonly ModuleEntry[]

export const MODULE_NAMES: string[] = MODULE_CATALOG.map((m) => m.name)

export function moduleEntry(name: string): ModuleEntry {
  const found = (MODULE_CATALOG as readonly ModuleEntry[]).find((m) => m.name === name)
  if (!found) throw new Error(`Unknown module "${name}" (${MODULE_NAMES.join(' | ')})`)
  return found
}
