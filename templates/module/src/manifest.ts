import { fileURLToPath } from 'node:url'
import type { ModuleManifest } from '@kit/runtime'
import { __name__Config } from './config'
import { outbox } from './infrastructure/persistence/schema'

/** What the host app needs to know about the module without building it: migrations, schema, outbox and config. */
export const __name__Manifest = {
  name: '__name__',
  dir: fileURLToPath(new URL('..', import.meta.url)),
  migrations: fileURLToPath(new URL('../migrations', import.meta.url)),
  schemaFile: fileURLToPath(
    new URL('../src/infrastructure/persistence/schema.ts', import.meta.url),
  ),
  outbox,
  config: __name__Config,
} as const satisfies ModuleManifest
