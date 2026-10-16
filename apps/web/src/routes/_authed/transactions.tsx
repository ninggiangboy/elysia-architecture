import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { PageHeader, Section } from '@/components/layout/page-header'
import { PageSkeleton } from '@/components/layout/page-skeleton'
import { BalanceCard } from '@/features/billing/balance-card'
import { transactionsQuery, walletQuery } from '@/features/billing/queries'
import { TransactionsList } from '@/features/billing/transactions-list'

export const Route = createFileRoute('/_authed/transactions')({
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(walletQuery),
      queryClient.ensureInfiniteQueryData(transactionsQuery),
    ]),
  pendingComponent: TransactionsSkeleton,
  component: TransactionsPage,
})

function TransactionsPage() {
  const { t } = useTranslation()
  return (
    <>
      <PageHeader
        title={t('billing.transactions.title')}
        description={t('billing.transactions.description')}
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

function TransactionsSkeleton() {
  const { t } = useTranslation()
  return <PageSkeleton label={t('billing.loading')} />
}
