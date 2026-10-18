import { Button, Card, CardContent } from '@kit/ui'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, Printer } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatDate, formatMoney } from '@/lib/format'
import { DocumentStatusBadge } from './document-status'
import { type BillingDocument, documentQuery } from './queries'

type Party = BillingDocument['seller']

function PartyBlock({ title, party }: { title: string; party: Party }) {
  const { t } = useTranslation()
  const lines = [party.name, party.address, party.email].filter(Boolean)
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">—</p>
      ) : (
        lines.map((line, i) => (
          <p key={line} className={i === 0 ? 'text-sm font-medium' : 'text-sm'}>
            {line}
          </p>
        ))
      )}
      {party.taxId && (
        <p className="text-sm">
          {t('billing.documents.taxId')}: {party.taxId}
        </p>
      )}
    </div>
  )
}

/**
 * An invoice, a receipt or a credit note as it was issued. The card is what gets printed (`data-print-area`, see
 * index.css): "Print" lets the browser save it as a PDF.
 */
export function DocumentView({ id }: { id: string }) {
  const { t } = useTranslation()
  const { data: doc } = useSuspenseQuery(documentQuery(id))
  const sign = doc.kind === 'credit_note' ? '−' : ''

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Button asChild variant="ghost" size="sm">
          <Link to="/settings/wallet/documents">
            <ArrowLeft aria-hidden /> {t('billing.documents.back')}
          </Link>
        </Button>
        <Button size="sm" variant="outline" onClick={() => window.print()}>
          <Printer aria-hidden /> {t('billing.documents.print')}
        </Button>
      </div>

      <Card data-print-area data-testid={`document-${doc.kind}`}>
        <CardContent className="flex flex-col gap-8 sm:p-8">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight">
                {t(`billing.documents.kind.${doc.kind}`)}
                <DocumentStatusBadge document={doc} />
              </h2>
              <p className="text-sm text-muted-foreground" data-testid="document-number">
                {doc.number}
              </p>
            </div>
            <dl className="text-sm sm:text-right">
              <dt className="text-xs text-muted-foreground">{t('billing.documents.issued')}</dt>
              <dd className="font-medium">{formatDate(doc.issuedAt)}</dd>
              {doc.settledAt && (
                <>
                  <dt className="mt-2 text-xs text-muted-foreground">
                    {t(`billing.documents.settled.${doc.status === 'paid' ? 'paid' : 'void'}`)}
                  </dt>
                  <dd className="font-medium">{formatDate(doc.settledAt)}</dd>
                </>
              )}
            </dl>
          </header>

          <div className="grid gap-6 sm:grid-cols-2">
            <PartyBlock title={t('billing.documents.from')} party={doc.seller} />
            <PartyBlock title={t('billing.documents.billedTo')} party={doc.buyer} />
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-2 font-medium">{t('billing.documents.lineDescription')}</th>
                <th className="py-2 text-right font-medium">{t('billing.documents.quantity')}</th>
                <th className="py-2 text-right font-medium">{t('billing.documents.amount')}</th>
              </tr>
            </thead>
            <tbody>
              {doc.lines.map((line) => (
                <tr key={line.description} className="border-b border-border">
                  <td className="py-3">{line.description}</td>
                  <td className="py-3 text-right tabular-nums">{line.quantity}</td>
                  <td className="py-3 text-right tabular-nums">
                    {sign}
                    {formatMoney(line.amount, doc.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th colSpan={2} scope="row" className="py-3 text-right font-medium">
                  {t(
                    doc.kind === 'receipt'
                      ? 'billing.documents.totalPaid'
                      : doc.kind === 'credit_note'
                        ? 'billing.documents.totalCredited'
                        : 'billing.documents.total',
                  )}
                </th>
                <td
                  className="py-3 text-right text-base font-semibold tabular-nums"
                  data-testid="document-total"
                >
                  {sign}
                  {formatMoney(doc.amount, doc.currency)}
                </td>
              </tr>
            </tfoot>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
