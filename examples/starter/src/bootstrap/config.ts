import { type ConfigSlice, coreConfig, type Env, type LoadedConfig, loadConfig } from '@kit/config'
import { dbConfig } from '@kit/db'
import { mailConfig } from '@kit/mail'
import { outboxConfig } from '@kit/messaging'
import { maintenanceConfig } from '@kit/runtime'
import { storageConfig } from '@kit/storage'
import { telemetryConfig } from '@kit/telemetry'
import { MODULE_CATALOG } from './module-catalog'

/** The slices that belong to the kit, in the order they appear in `.env.example`. */
const KIT_SLICES = {
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

/** Every slice of the configuration: the kit's, then each installed module's own (from the catalog). */
export const CONFIG_SLICES = {
  ...KIT_SLICES,
  ...Object.fromEntries(MODULE_CATALOG.flatMap((m) => (m.config ? [[m.name, m.config]] : []))),
} as typeof KIT_SLICES & ModuleSlices

export type Config = LoadedConfig<typeof CONFIG_SLICES>

export const loadAppConfig = (env?: Env): Config => loadConfig(CONFIG_SLICES, env)

/** What the sample `.env` sets over the slices' own examples: everything runs on the local disk and in the log. */
export const ENV_EXAMPLE = {
  STORAGE_DRIVER: 'local',
  STORAGE_LOCAL_SECRET: '',
  MAIL_DRIVER: 'console',
  // The S3 values of the slice's example are for the s3 driver.
  S3_ENDPOINT: null,
  S3_PUBLIC_ENDPOINT: null,
  S3_BUCKET: null,
  S3_ACCESS_KEY_ID: null,
  S3_SECRET_ACCESS_KEY: null,
  OTEL_EXPORTER_OTLP_ENDPOINT: null,
  SMTP_HOST: null,
  SMTP_PORT: null,
  MAIL_FROM: null,
} as const
