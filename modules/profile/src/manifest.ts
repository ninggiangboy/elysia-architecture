import { fileURLToPath } from 'node:url'
import type { ModuleManifest } from '@kit/runtime'
import { outbox } from './infrastructure/persistence/schema'

/** What the host app needs to know about the module without building it: migrations, schema, outbox and config. */
export const profileManifest = {
  name: 'profile',
  dir: fileURLToPath(new URL('..', import.meta.url)),
  migrations: fileURLToPath(new URL('../migrations', import.meta.url)),
  schemaFile: fileURLToPath(new URL('./infrastructure/persistence/schema.ts', import.meta.url)),
  outbox: outbox,
  config: undefined,
} as const satisfies ModuleManifest
