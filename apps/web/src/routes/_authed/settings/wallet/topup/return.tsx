import { Button, Card, CardContent, CardFooter } from '@kit/ui'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { CircleCheck, CircleX, LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Section } from '@/components/layout/page-header'
import { receiptOfTopUpQuery, topUpQuery } from '@/features/billing/queries'
import { formatMoney } from '@/lib/format'

/** Where Stripe sends the buyer back to (and where a card payment that settled in place ends up). */
export const Route = createFileRoute('/_authed/settings/wallet/topup/return')({
  // Stripe adds its own parameters (`payment_intent`, `redirect_status`…); only ours matters.
  validateSearch: (search: Record<string, unknown>): { topUp: string } => ({
    topUp: typeof search.topUp === 'string' ? search.topUp : '',
  }),
  component: TopUpReturn,
})

const POLL_MS = 1500
/** The webhook normally lands within a second or two; past this, say so instead of spinning for ever. */
const SLOW_AFTER_MS = 20_000

type View = 'pending' | 'succeeded' | 'failed' | 'canceled' | 'unknown'

function Outcome({
  view,
  slow,
  amount,
  reason,
}: {
  view: View
  slow: boolean
  amount: string
  reason: string | null
}) {
  const { t } = useTranslation()
  switch (view) {
    case 'pending':
      return (
        <>
          <LoaderCircle className="size-8 animate-spin text-muted-foreground" aria-hidden />
          <p className="font-medium">{t('billing.return.pending')}</p>
          {slow && (
            <p className="max-w-md text-sm text-muted-foreground">{t('billing.return.slow')}</p>
          )}
        </>
      )
    case 'succeeded':
      return (
        <>
          <CircleCheck className="size-8 text-success" aria-hidden />
          <p className="font-medium">{t('billing.return.succeeded')}</p>
          <p className="text-sm text-muted-foreground">
            {t('billing.return.succeededBody', { amount })}
          </p>
        </>
      )
    case 'failed':
    case 'canceled':
      return (
        <>
          <CircleX className="size-8 text-destructive" aria-hidden />
          <p className="font-medium">
            {t(view === 'failed' ? 'billing.return.failed' : 'billing.return.canceled')}
          </p>
          <p className="max-w-md text-sm text-muted-foreground">
            {reason ?? t('billing.return.failedBody')}
          </p>
        </>
      )
    default:
      return (
        <>
          <CircleX className="size-8 text-destructive" aria-hidden />
          <p className="font-medium">{t('billing.return.unknown')}</p>
        </>
      )
  }
}

function TopUpReturn() {
  const { t } = useTranslation()
  const { topUp: id } = Route.useSearch()
  const [slow, setSlow] = useState(false)
  const { data, isError } = useQuery({
    ...topUpQuery(id),
    enabled: id !== '',
    // The wallet is credited by Stripe's webhook, not by this page: wait for it, and stop once it has settled.
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? POLL_MS : false),
  })

  // The receipt is issued in the same step that credits the wallet, so it is there as soon as the top-up has succeeded.
  const { data: receipt } = useQuery({
    ...receiptOfTopUpQuery(id),
    enabled: data?.status === 'succeeded',
  })

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS)
    return () => clearTimeout(timer)
  }, [])

  const view: View = isError || id === '' ? 'unknown' : (data?.status ?? 'pending')
  const retry = view !== 'pending' && view !== 'succeeded'

  return (
    <>
      <Section stacked title={t('billing.return.title')}>
        <Card>
          <CardContent
            className="flex flex-col items-center gap-3 py-10 text-center"
            role="status"
            data-testid={`return-${view}`}
          >
            <Outcome
              view={view}
              slow={slow}
              amount={data ? formatMoney(data.amount, data.currency) : ''}
              reason={data?.failureReason ?? null}
            />
          </CardContent>
          <CardFooter className="justify-end">
            {retry && (
              <Button asChild variant="outline" size="sm">
                <Link to="/settings/wallet/topup">{t('billing.return.tryAgain')}</Link>
              </Button>
            )}
            {receipt && (
              <Button asChild variant="outline" size="sm">
                <Link to="/settings/wallet/documents/$id" params={{ id: receipt.id }}>
                  {t('billing.return.viewReceipt')}
                </Link>
              </Button>
            )}
            <Button asChild size="sm">
              <Link to="/settings/wallet">{t('billing.return.toWallet')}</Link>
            </Button>
          </CardFooter>
        </Card>
      </Section>
    </>
  )
}
