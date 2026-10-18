import { type ConfigSlice, type Env, type LoadedConfig, loadConfig } from '#/shared/config'
import { coreConfig } from '#/shared/config/core'
import { dbConfig } from '#/shared/infrastructure/db/config'
import { mailConfig } from '#/shared/infrastructure/mail/config'
import { maintenanceConfig } from '#/shared/infrastructure/maintenance/config'
import { outboxConfig } from '#/shared/infrastructure/outbox/config'
import { storageConfig } from '#/shared/infrastructure/storage/config'
import { telemetryConfig } from '#/shared/infrastructure/telemetry/config'
import { MODULE_CATALOG } from './module-catalog'

/** The slices that belong to the infrastructure, in the order they appear in `.env.example`. */
const INFRASTRUCTURE_SLICES = {
  core: coreConfig,
  db: dbConfig,
  storage: storageConfig,
  mail: mailConfig,
  outbox: outboxConfig,
  maintenance: maintenanceConfig,
  telemetry: telemetryConfig,
} as const

type ModuleSlices = {
  [E in (typeof MODULE_CATALOG)[number] as E['config'] extends ConfigSlice
    ? E['name']
    : never]: E['config']
}

/**
 * Every slice of the configuration: the infrastructure's, then each module's own (from the module catalog, so adding or
 * removing a module adds or removes its variables). The container hands each factory exactly its slice (`config.billing`).
 */
export const CONFIG_SLICES = {
  ...INFRASTRUCTURE_SLICES,
  ...Object.fromEntries(MODULE_CATALOG.flatMap((m) => (m.config ? [[m.name, m.config]] : []))),
} as typeof INFRASTRUCTURE_SLICES & ModuleSlices

export type Config = LoadedConfig<typeof CONFIG_SLICES>

export const loadAppConfig = (env?: Env): Config => loadConfig(CONFIG_SLICES, env)
