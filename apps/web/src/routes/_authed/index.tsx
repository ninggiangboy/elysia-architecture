import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Section } from '@/components/layout/page-header'
import { PageSkeleton } from '@/components/layout/page-skeleton'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { passkeysQuery } from '@/features/account/queries'
import { SetupChecklist } from '@/features/account/setup-checklist'
import { BalanceCard } from '@/features/billing/balance-card'
import { transactionsQuery, walletQuery } from '@/features/billing/queries'
import { TransactionsList } from '@/features/billing/transactions-list'
import { meQuery } from '@/features/profile/queries'
import { formatDate } from '@/lib/format'

export const Route = createFileRoute('/_authed/')({
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(meQuery),
      queryClient.ensureQueryData(walletQuery),
      queryClient.ensureInfiniteQueryData(transactionsQuery),
      queryClient.ensureQueryData(passkeysQuery),
    ]),
  pendingComponent: OverviewSkeleton,
  component: OverviewPage,
})

/** Home: who you are, where your money stands, and what to do next. Everything editable lives in Settings. */
function OverviewPage() {
  const { t } = useTranslation()
  const { data: me } = useSuspenseQuery(meQuery)

  return (
    <>
      <Card>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-5">
          <Avatar
            decorative
            src={me.avatarUrl}
            name={me.displayName}
            className="size-16 text-2xl"
          />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-semibold tracking-tight">
              {t('overview.welcome', { name: me.displayName })}
            </h1>
            <p className="truncate text-sm text-muted-foreground" data-testid="account-email">
              {me.email}
            </p>
            {me.createdAt && (
              <p className="mt-0.5 text-xs text-muted-foreground/80">
                {t('menu.memberSince', { date: formatDate(me.createdAt) })}
              </p>
            )}
          </div>
          <Button asChild variant="outline" size="sm" className="self-start sm:self-center">
            <Link to="/settings/profile">{t('overview.editProfile')}</Link>
          </Button>
        </CardContent>
      </Card>

      <SetupChecklist />

      <Section title={t('overview.walletTitle')} description={t('billing.balance.description')}>
        <BalanceCard
          action={
            <Button asChild size="sm">
              <Link to="/wallet/topup">
                <Plus aria-hidden /> {t('billing.wallet.topUp')}
              </Link>
            </Button>
          }
        />
      </Section>
      <Section
        title={t('overview.recentTitle')}
        description={t('billing.transactions.historyDescription')}
      >
        <TransactionsList limit={5} />
      </Section>
    </>
  )
}

function OverviewSkeleton() {
  const { t } = useTranslation()
  return <PageSkeleton label={t('overview.loading')} />
}
