import { UserRound } from 'lucide-react'
import type { FeatureDefinition } from '../feature'
import { en } from './i18n/en'
import { vi } from './i18n/vi'

export const profileFeature = {
  name: 'profile',
  settingsTabs: [
    { to: '/settings/profile', label: 'settings.nav.profile', icon: UserRound, order: 10 },
  ],
  i18n: { en, vi },
} as const satisfies FeatureDefinition
