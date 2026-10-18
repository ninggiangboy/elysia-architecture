import type { FeatureDefinition } from '../feature'
import { en } from './i18n/en'
import { vi } from './i18n/vi'

export const realtimeFeature = {
  name: 'realtime',
  i18n: { en, vi },
} as const satisfies FeatureDefinition
