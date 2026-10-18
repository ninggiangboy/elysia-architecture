import type { LucideIcon } from 'lucide-react'
import type { FileRoutesByTo } from '@/routeTree.gen'

/** A tab of the settings page. */
export interface SettingsTab {
  to: keyof FileRoutesByTo
  /** Key of the label in the catalog (`settings.nav.<name>`). */
  label: string
  icon: LucideIcon
  /** Tabs are sorted by this; leave gaps so a new feature can slot in between. */
  order: number
}

/**
 * What a feature gives the shell. The app lists its features in `features/index.ts` and builds navigation and the message
 * catalog from them, so adding or removing a feature is deleting its folder, its routes and one line there.
 * Only light things belong in a feature's `index.ts` (no components): the shell imports it at start-up.
 */
export interface FeatureDefinition {
  name: string
  settingsTabs?: readonly SettingsTab[]
  /** The feature's messages: the top-level branches of the catalog it owns, per language. */
  i18n?: { en: object; vi: object }
}
