import { useSuspenseInfiniteQuery } from '@tanstack/react-query'
import { ArrowDownLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardFooter } from '@/components/ui/card'
import { formatDate, formatMoney } from '@/lib/format'
import { type Transaction, transactionsQuery } from './queries'

const STATUS = {
  pending: { label: 'billing.status.pending', variant: 'default' },
  succeeded: { label: 'billing.status.succeeded', variant: 'success' },
  failed: { label: 'billing.status.failed', variant: 'warning' },
  canceled: { label: 'billing.status.canceled', variant: 'default' },
} as const satisfies Record<
  Transaction['status'],
  { label: string; variant: 'default' | 'success' | 'warning' }
>

function Row({ item }: { item: Transaction }) {
  const { t } = useTranslation()
  return (
    <li className="flex items-center gap-3 px-5 py-4 sm:px-6" data-testid="transaction">
      <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-muted/50 text-muted-foreground">
        <ArrowDownLeft className="size-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {t('billing.transactions.topup')}
          <Badge variant={STATUS[item.status].variant}>{t(STATUS[item.status].label)}</Badge>
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {formatDate(item.createdAt)}
          {item.status === 'failed' && item.failureReason ? ` · ${item.failureReason}` : ''}
        </p>
      </div>
      <p
        className={`shrink-0 text-sm font-semibold tabular-nums ${
          item.status === 'succeeded' ? 'text-success' : 'text-muted-foreground'
        }`}
      >
        {item.status === 'succeeded' ? '+' : ''}
        {formatMoney(item.amount, item.currency)}
      </p>
    </li>
  )
}

export function TransactionsList() {
  const { t } = useTranslation()
  const { data, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useSuspenseInfiniteQuery(transactionsQuery)
  const items = data.pages.flatMap((page) => page.items)

  return (
    <Card>
      {items.length === 0 ? (
        <p
          className="px-5 py-6 text-sm text-muted-foreground sm:px-6"
          data-testid="no-transactions"
        >
          {t('billing.transactions.none')}
        </p>
      ) : (
        <ul className="divide-y divide-border" aria-label={t('billing.transactions.list')}>
          {items.map((item) => (
            <Row key={item.id} item={item} />
          ))}
        </ul>
      )}
      {hasNextPage && (
        <CardFooter className="justify-center">
          <Button
            size="sm"
            variant="outline"
            loading={isFetchingNextPage}
            onClick={() => void fetchNextPage()}
          >
            {t('billing.transactions.loadMore')}
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}
