import { createFileRoute, Link } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PageHeader, Section } from '@/components/layout/page-header'
import { PageSkeleton } from '@/components/layout/page-skeleton'
import { Button } from '@/components/ui/button'
import { BalanceCard } from '@/features/billing/balance-card'
import { billingConfigQuery, transactionsQuery, walletQuery } from '@/features/billing/queries'
import { TransactionsList } from '@/features/billing/transactions-list'

export const Route = createFileRoute('/_authed/wallet/')({
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(walletQuery),
      queryClient.ensureInfiniteQueryData(transactionsQuery),
      queryClient.prefetchQuery(billingConfigQuery),
    ]),
  pendingComponent: WalletSkeleton,
  component: WalletPage,
})

function WalletPage() {
  const { t } = useTranslation()
  return (
    <>
      <PageHeader
        title={t('billing.wallet.title')}
        description={t('billing.wallet.description')}
        actions={
          <Button asChild>
            <Link to="/wallet/topup">
              <Plus aria-hidden /> {t('billing.wallet.topUp')}
            </Link>
          </Button>
        }
      />
      <Section title={t('billing.balance.title')} description={t('billing.balance.description')}>
        <BalanceCard />
      </Section>
      <Section
        title={t('billing.transactions.historyTitle')}
        description={t('billing.transactions.historyDescription')}
      >
        <TransactionsList />
      </Section>
    </>
  )
}

function WalletSkeleton() {
  const { t } = useTranslation()
  return <PageSkeleton label={t('billing.loading')} />
}
