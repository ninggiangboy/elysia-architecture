import { Wallet } from 'lucide-react'
import type { FeatureDefinition } from '../feature'
import { en } from './i18n/en'
import { vi } from './i18n/vi'

export const billingFeature = {
  name: 'billing',
  settingsTabs: [{ to: '/settings/wallet', label: 'settings.nav.wallet', icon: Wallet, order: 50 }],
  i18n: { en, vi },
} as const satisfies FeatureDefinition
