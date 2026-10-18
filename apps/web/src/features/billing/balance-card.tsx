import { Card } from '@kit/ui'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Wallet } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { formatMoney } from '@/lib/format'
import { walletQuery } from './queries'

/** One balance per currency the wallet was ever topped up in. */
export function BalanceCard({ action }: { action?: ReactNode }) {
  const { t } = useTranslation()
  const { data: balances } = useSuspenseQuery(walletQuery)

  return (
    <Card>
      {balances.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground sm:px-6" data-testid="no-balance">
          {t('billing.balance.none')}
        </p>
      ) : (
        <ul
          className="grid divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0"
          aria-label={t('billing.balance.list')}
        >
          {balances.map((b) => (
            <li
              key={b.currency}
              className="flex items-center gap-3 px-5 py-4 sm:px-6"
              data-testid={`balance-${b.currency}`}
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-muted/50 text-muted-foreground">
                <Wallet className="size-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {b.currency}
                </p>
                <p className="truncate text-lg font-semibold tabular-nums">
                  {formatMoney(b.amount, b.currency)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {action && (
        <div className="flex justify-end border-t border-border px-5 py-3 sm:px-6">{action}</div>
      )}
    </Card>
  )
}
