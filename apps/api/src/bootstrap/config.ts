import { type ConfigSlice, coreConfig, type Env, type LoadedConfig, loadConfig } from '@kit/config'
import { dbConfig } from '@kit/db'
import { outboxConfig } from '@kit/messaging'
import { telemetryConfig } from '@kit/telemetry'
import { mailConfig } from '#/shared/mail'
import { maintenanceConfig } from '#/shared/runtime'
import { storageConfig } from '#/shared/storage'
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
