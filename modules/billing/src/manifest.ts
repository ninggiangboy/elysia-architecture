import { fileURLToPath } from 'node:url'
import type { ModuleManifest } from '@kit/runtime'
import { billingConfig } from './config'
import { outbox } from './infrastructure/persistence/schema'

/** What the host app needs to know about the module without building it: migrations, schema, outbox and config. */
export const billingManifest = {
  name: 'billing',
  dir: fileURLToPath(new URL('..', import.meta.url)),
  migrations: fileURLToPath(new URL('../migrations', import.meta.url)),
  schemaFile: fileURLToPath(
    new URL('../src/infrastructure/persistence/schema.ts', import.meta.url),
  ),
  outbox: outbox,
  config: billingConfig,
} as const satisfies ModuleManifest
