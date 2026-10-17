import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import type { BillingDocument } from './queries'

const VARIANT = {
  open: 'warning',
  paid: 'success',
  void: 'default',
  issued: 'success',
} as const satisfies Record<BillingDocument['status'], 'default' | 'success' | 'warning'>

/** `open`/`paid`/`void` for an invoice, `void` for a withdrawn credit note; a receipt or a credit note in force needs no badge. */
export function DocumentStatusBadge({ document }: { document: BillingDocument }) {
  const { t } = useTranslation()
  if (document.status === 'issued') return null
  return (
    <Badge variant={VARIANT[document.status]}>
      {t(`billing.documents.status.${document.status}`)}
    </Badge>
  )
}
