import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Section } from '@/components/layout/page-header'
import { PageSkeleton } from '@/components/layout/page-skeleton'
import { ConnectedAccounts } from '@/features/account/connected-accounts'
import { PasskeysCard } from '@/features/account/passkeys-card'
import { connectedAccountsQuery, passkeysQuery, sessionsQuery } from '@/features/account/queries'
import { SessionsList } from '@/features/account/sessions-list'
import { oauthProvidersQuery } from '@/features/auth/queries'

export const Route = createFileRoute('/_authed/settings/security')({
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(passkeysQuery),
      queryClient.ensureQueryData(connectedAccountsQuery),
      queryClient.ensureQueryData(oauthProvidersQuery),
      queryClient.ensureQueryData(sessionsQuery),
    ]),
  pendingComponent: SecuritySkeleton,
  component: SecurityPage,
})

function SecurityPage() {
  const { t } = useTranslation()
  return (
    <>
      <Section
        stacked
        title={t('security.passkeysTitle')}
        description={t('security.passkeysDescription')}
      >
        <PasskeysCard />
      </Section>
      <Section
        stacked
        title={t('security.accountsTitle')}
        description={t('security.accountsDescription')}
      >
        <ConnectedAccounts />
      </Section>
      <Section
        stacked
        title={t('profile.devicesTitle')}
        description={t('profile.devicesDescription')}
      >
        <SessionsList />
      </Section>
    </>
  )
}

function SecuritySkeleton() {
  const { t } = useTranslation()
  return <PageSkeleton label={t('security.loading')} sections={3} />
}
