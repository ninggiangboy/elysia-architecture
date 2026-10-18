import { fileURLToPath } from 'node:url'
import type { ModuleManifest } from '@kit/runtime'
import { identityConfig } from './config'
import { outbox } from './infrastructure/persistence/schema'

/** What the host app needs to know about the module without building it: migrations, schema, outbox and config. */
export const identityManifest = {
  name: 'identity',
  dir: fileURLToPath(new URL('..', import.meta.url)),
  migrations: fileURLToPath(new URL('../migrations', import.meta.url)),
  schemaFile: fileURLToPath(new URL('./infrastructure/persistence/schema.ts', import.meta.url)),
  outbox: outbox,
  config: identityConfig,
} as const satisfies ModuleManifest
