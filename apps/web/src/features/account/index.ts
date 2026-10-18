import { ShieldCheck, SlidersHorizontal } from 'lucide-react'
import type { FeatureDefinition } from '../feature'
import { en } from './i18n/en'
import { vi } from './i18n/vi'

export const accountFeature = {
  name: 'account',
  settingsTabs: [
    { to: '/settings/account', label: 'settings.nav.account', icon: SlidersHorizontal, order: 20 },
    { to: '/settings/security', label: 'settings.nav.security', icon: ShieldCheck, order: 30 },
  ],
  i18n: { en, vi },
} as const satisfies FeatureDefinition
