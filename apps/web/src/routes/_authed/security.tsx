import { createFileRoute, Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { PageHeader, Section } from '@/components/layout/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { ConnectedAccounts } from '@/features/account/connected-accounts'
import { PasskeysCard } from '@/features/account/passkeys-card'
import { connectedAccountsQuery, passkeysQuery } from '@/features/account/queries'
import { oauthProvidersQuery } from '@/features/auth/queries'

export const Route = createFileRoute('/_authed/security')({
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(passkeysQuery),
      queryClient.ensureQueryData(connectedAccountsQuery),
      queryClient.ensureQueryData(oauthProvidersQuery),
    ]),
  pendingComponent: SecuritySkeleton,
  component: SecurityPage,
})

function SecurityPage() {
  const { t } = useTranslation()
  return (
    <>
      <PageHeader title={t('security.title')} description={t('security.description')} />
      <Section title={t('security.passkeysTitle')} description={t('security.passkeysDescription')}>
        <PasskeysCard />
      </Section>
      <Section title={t('security.accountsTitle')} description={t('security.accountsDescription')}>
        <ConnectedAccounts />
      </Section>
      <Section title={t('security.dataTitle')} description={t('security.dataDescription')}>
        <Link to="/privacy" className="text-sm font-medium text-primary hover:underline">
          {t('security.dataLink')}
        </Link>
      </Section>
    </>
  )
}

function SecuritySkeleton() {
  const { t } = useTranslation()
  return (
    <div
      role="status"
      className="flex flex-col gap-8"
      aria-busy="true"
      aria-label={t('security.loading')}
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      {[0, 1].map((i) => (
        <div key={i} className="grid gap-4 border-t border-border pt-8 md:grid-cols-3 md:gap-10">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-full" />
          </div>
          <Skeleton className="h-32 rounded-xl md:col-span-2" />
        </div>
      ))}
    </div>
  )
}
