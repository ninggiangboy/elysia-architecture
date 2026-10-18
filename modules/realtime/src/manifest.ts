import { fileURLToPath } from 'node:url'
import type { ModuleManifest } from '@kit/runtime'
import { realtimeConfig } from './config'

/** What the host app needs to know about the module without building it: migrations, schema, outbox and config. */
export const realtimeManifest = {
  name: 'realtime',
  dir: fileURLToPath(new URL('..', import.meta.url)),
  migrations: fileURLToPath(new URL('../migrations', import.meta.url)),
  schemaFile: fileURLToPath(new URL('./infrastructure/persistence/schema.ts', import.meta.url)),
  outbox: null,
  config: realtimeConfig,
} as const satisfies ModuleManifest
