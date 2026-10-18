import { Bell } from 'lucide-react'
import type { FeatureDefinition } from '../feature'
import { en } from './i18n/en'
import { vi } from './i18n/vi'

export const notificationsFeature = {
  name: 'notifications',
  settingsTabs: [
    { to: '/settings/notifications', label: 'settings.nav.notifications', icon: Bell, order: 40 },
  ],
  i18n: { en, vi },
} as const satisfies FeatureDefinition
