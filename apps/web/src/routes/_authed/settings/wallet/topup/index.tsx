import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Section } from '@/components/layout/page-header'
import { PageSkeleton } from '@/components/layout/page-skeleton'
import { BalanceCard } from '@/features/billing/balance-card'
import { billingConfigQuery, walletQuery } from '@/features/billing/queries'
import { TopUpForm } from '@/features/billing/topup-form'

export const Route = createFileRoute('/_authed/settings/wallet/topup/')({
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
      <Link
        to="/settings/wallet"
        className="-mb-4 inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> {t('settings.nav.wallet')}
      </Link>
      <Section
        stacked
        title={t('billing.balance.title')}
        description={t('billing.balance.description')}
      >
        <BalanceCard />
      </Section>
      <Section
        stacked
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
