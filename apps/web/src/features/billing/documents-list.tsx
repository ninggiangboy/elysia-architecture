import type { DocumentKind } from '@mod/billing/public'
import { useSuspenseInfiniteQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { FileText } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card, CardFooter } from '@/components/ui/card'
import { formatDate, formatMoney } from '@/lib/format'
import { DocumentStatusBadge } from './document-status'
import { type BillingDocument, documentsQuery } from './queries'

const FILTERS = [undefined, 'invoice', 'receipt', 'credit_note'] as const satisfies readonly (
  | DocumentKind
  | undefined
)[]

function Row({ item }: { item: BillingDocument }) {
  const { t } = useTranslation()
  return (
    <li data-testid="document">
      <Link
        to="/settings/wallet/documents/$id"
        params={{ id: item.id }}
        className="flex items-center gap-3 px-5 py-4 transition-colors hover:bg-muted/50 sm:px-6"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-muted/50 text-muted-foreground">
          <FileText className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            {t(`billing.documents.kind.${item.kind}`)}
            <DocumentStatusBadge document={item} />
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {item.number} · {formatDate(item.issuedAt)}
          </p>
        </div>
        <p className="shrink-0 text-sm font-semibold tabular-nums">
          {item.kind === 'credit_note' ? '−' : ''}
          {formatMoney(item.amount, item.currency)}
        </p>
      </Link>
    </li>
  )
}

/** Invoices, receipts and credit notes, newest first, with a filter by kind. */
export function DocumentsList() {
  const { t } = useTranslation()
  const [kind, setKind] = useState<DocumentKind | undefined>(undefined)
  const { data, hasNextPage, fetchNextPage, isFetchingNextPage } = useSuspenseInfiniteQuery(
    documentsQuery(kind),
  )
  const items = data.pages.flatMap((page) => page.items)

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">{t('billing.documents.filter')}</legend>
        {FILTERS.map((k) => (
          <Button
            key={k ?? 'all'}
            type="button"
            size="sm"
            variant={k === kind ? 'default' : 'outline'}
            aria-pressed={k === kind}
            onClick={() => setKind(k)}
            data-testid={`documents-filter-${k ?? 'all'}`}
          >
            {t(k ? `billing.documents.filters.${k}` : 'billing.documents.filters.all')}
          </Button>
        ))}
      </fieldset>
      <Card>
        {items.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground sm:px-6" data-testid="no-documents">
            {t('billing.documents.none')}
          </p>
        ) : (
          <ul className="divide-y divide-border" aria-label={t('billing.documents.list')}>
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
    </div>
  )
}
