import type { ModuleManifest } from '@kit/runtime'
import { billingManifest } from '@mod/billing/manifest'
import { identityManifest } from '@mod/identity/manifest'
import { notificationManifest } from '@mod/notification/manifest'
import { privacyManifest } from '@mod/privacy/manifest'
import { profileManifest } from '@mod/profile/manifest'
import { realtimeManifest } from '@mod/realtime/manifest'

/**
 * The modules this app installs, as static data: it builds nothing, so the CLI scripts can read it without pulling in the
 * container. Each module package exports its manifest (migrations, schema, outbox, config). The order is the order
 * migrations run in. One line per module; removing a module removes its line (and its entries in container.ts and app.ts).
 */
export const MODULE_CATALOG = [
  identityManifest,
  profileManifest,
  notificationManifest,
  privacyManifest,
  billingManifest,
  realtimeManifest,
  // <kit:catalog>
] as const satisfies readonly ModuleManifest[]

export const MODULE_NAMES: string[] = MODULE_CATALOG.map((m) => m.name)
