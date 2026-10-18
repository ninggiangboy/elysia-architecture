import { accountFeature } from './account'
import { authFeature } from './auth'
import { billingFeature } from './billing'
import type { FeatureDefinition } from './feature'
import { notificationsFeature } from './notifications'
import { privacyFeature } from './privacy'
import { profileFeature } from './profile'
import { realtimeFeature } from './realtime'

/**
 * The features of this app, one line each. Navigation (settings tabs) and the message catalog are built from this list:
 * removing a feature means deleting `features/<name>`, its routes and its line here.
 */
export const FEATURES = [
  authFeature,
  profileFeature,
  accountFeature,
  notificationsFeature,
  privacyFeature,
  billingFeature,
  realtimeFeature,
] as const

const all: readonly FeatureDefinition[] = FEATURES

/** The tabs of the settings page, in order. */
export const SETTINGS_TABS = all
  .flatMap((feature) => feature.settingsTabs ?? [])
  .sort((a, b) => a.order - b.order)
