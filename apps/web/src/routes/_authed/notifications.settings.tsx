import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/layout/page-header'
import { PushToggle } from '@/features/notifications/push-toggle'

export const Route = createFileRoute('/_authed/notifications/settings')({
  component: NotificationSettingsPage,
})

function NotificationSettingsPage() {
  const { t } = useTranslation()
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <Link
        to="/"
        className="-mb-2 inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> {t('common.back')}
      </Link>
      <PageHeader
        title={t('notifications.settingsTitle')}
        description={t('notifications.settingsDescription')}
      />
      <PushToggle />
    </div>
  )
}
