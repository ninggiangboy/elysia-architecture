import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Section } from '@/components/layout/page-header'
import { PushToggle } from '@/features/notifications/push-toggle'

export const Route = createFileRoute('/_authed/settings/notifications')({
  component: NotificationSettingsPage,
})

function NotificationSettingsPage() {
  const { t } = useTranslation()
  return (
    <Section
      stacked
      title={t('notifications.settingsTitle')}
      description={t('notifications.settingsDescription')}
    >
      <PushToggle />
    </Section>
  )
}
