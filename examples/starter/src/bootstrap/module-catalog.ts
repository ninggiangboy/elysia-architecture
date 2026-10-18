import type { ModuleManifest } from '@kit/runtime'
import { identityManifest } from '@mod/identity/manifest'
import { profileManifest } from '@mod/profile/manifest'
// <kit:catalog-imports>

/**
 * The modules this app installs, as static data (migrations, schema, outbox, config). `bun run kit:add <module>` adds a line
 * here, in container.ts and in app.ts; `kit:remove` takes it out again.
 */
export const MODULE_CATALOG = [
  identityManifest,
  profileManifest,
  // <kit:catalog>
] as const satisfies readonly ModuleManifest[]

export const MODULE_NAMES: string[] = MODULE_CATALOG.map((m) => m.name)
