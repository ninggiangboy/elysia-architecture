import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { PageHeader, Section } from '@/components/layout/page-header'
import { PageSkeleton } from '@/components/layout/page-skeleton'
import { BalanceCard } from '@/features/billing/balance-card'
import { billingConfigQuery, walletQuery } from '@/features/billing/queries'
import { TopUpForm } from '@/features/billing/topup-form'

export const Route = createFileRoute('/_authed/topup/')({
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(billingConfigQuery),
      queryClient.ensureQueryData(walletQuery),
    ]),
  pendingComponent: TopUpSkeleton,
  component: TopUpPage,
})

function TopUpPage() {
  const { t } = useTranslation()
  return (
    <>
      <PageHeader title={t('billing.topup.title')} description={t('billing.topup.description')} />
      <Section title={t('billing.balance.title')} description={t('billing.balance.description')}>
        <BalanceCard />
      </Section>
      <Section
        title={t('billing.topup.formTitle')}
        description={t('billing.topup.formDescription')}
      >
        <TopUpForm />
      </Section>
    </>
  )
}

function TopUpSkeleton() {
  const { t } = useTranslation()
  return <PageSkeleton label={t('billing.loading')} />
}
