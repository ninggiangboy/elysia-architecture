import { createFileRoute, Link } from '@tanstack/react-router'
import { FileText, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Section } from '@/components/layout/page-header'
import { PageSkeleton } from '@/components/layout/page-skeleton'
import { Button } from '@/components/ui/button'
import { BalanceCard } from '@/features/billing/balance-card'
import { billingConfigQuery, transactionsQuery, walletQuery } from '@/features/billing/queries'
import { TransactionsList } from '@/features/billing/transactions-list'

export const Route = createFileRoute('/_authed/settings/wallet/')({
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
      <Section
        stacked
        title={t('billing.balance.title')}
        description={t('billing.balance.description')}
      >
        <BalanceCard
          action={
            <Button asChild size="sm">
              <Link to="/settings/wallet/topup">
                <Plus aria-hidden /> {t('billing.wallet.topUp')}
              </Link>
            </Button>
          }
        />
      </Section>
      <Section
        stacked
        title={t('billing.transactions.historyTitle')}
        description={t('billing.transactions.historyDescription')}
      >
        <TransactionsList />
      </Section>
      <Section
        stacked
        title={t('billing.documents.title')}
        description={t('billing.documents.description')}
      >
        <Button asChild variant="outline" size="sm" className="w-fit">
          <Link to="/settings/wallet/documents">
            <FileText aria-hidden /> {t('billing.documents.open')}
          </Link>
        </Button>
      </Section>
    </>
  )
}

function WalletSkeleton() {
  const { t } = useTranslation()
  return <PageSkeleton label={t('billing.loading')} />
}
