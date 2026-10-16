import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Section } from '@/components/layout/page-header'
import { PageSkeleton } from '@/components/layout/page-skeleton'
import { ChangeEmailForm } from '@/features/account/change-email-form'
import { PreferencesCard } from '@/features/account/preferences-card'
import { DeletionCard } from '@/features/privacy/deletion-card'
import { ExportCard } from '@/features/privacy/export-card'
import { deletionQuery, exportsQuery } from '@/features/privacy/queries'
import { meQuery } from '@/features/profile/queries'

export const Route = createFileRoute('/_authed/settings/account')({
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(meQuery),
      queryClient.ensureQueryData(exportsQuery),
      queryClient.ensureQueryData(deletionQuery),
    ]),
  pendingComponent: AccountSkeleton,
  component: AccountPage,
})

function AccountPage() {
  const { t } = useTranslation()
  const { data: me } = useSuspenseQuery(meQuery)
  return (
    <>
      <Section stacked title={t('profile.emailTitle')} description={t('profile.emailDescription')}>
        <ChangeEmailForm currentEmail={me.email} />
      </Section>
      <Section
        stacked
        title={t('settings.preferences.title')}
        description={t('settings.preferences.description')}
      >
        <PreferencesCard />
      </Section>
      <Section
        stacked
        title={t('privacy.exportTitle')}
        description={t('privacy.exportDescription')}
      >
        <ExportCard />
      </Section>
      <Section
        stacked
        title={t('privacy.deleteTitle')}
        description={t('privacy.deleteDescription')}
      >
        <DeletionCard />
      </Section>
    </>
  )
}

function AccountSkeleton() {
  const { t } = useTranslation()
  return <PageSkeleton label={t('settings.loading')} sections={3} />
}
