import type { DocumentKind, DocumentStatus } from '@app/shared-types'
import { NotFoundError } from '#/shared/application/errors'
import type { DocumentRepository } from '../../domain/billing-repository'
import type { BillingDocument, DocumentLine, Party } from '../../domain/document'
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './read-billing'

export interface DocumentView {
  id: string
  kind: DocumentKind
  /** What is printed on it: `INV-2026-000001`. */
  number: string
  status: DocumentStatus
  topUpId: string
  /** The invoice a receipt or a credit note belongs to. */
  invoiceId: string | null
  currency: string
  amount: number
  seller: Party
  buyer: Party
  lines: DocumentLine[]
  issuedAt: string
  /** When the invoice was paid or voided (or the credit note voided); `null` otherwise. */
  settledAt: string | null
}

const toView = (document: BillingDocument): DocumentView => {
  const p = document.props
  return {
    id: p.id,
    kind: p.kind,
    number: p.number,
    status: p.status,
    topUpId: p.topUpId,
    invoiceId: p.invoiceId,
    currency: p.currency,
    amount: p.amount,
    seller: p.seller,
    buyer: p.buyer,
    lines: p.lines,
    issuedAt: p.issuedAt.toISOString(),
    settledAt: p.settledAt?.toISOString() ?? null,
  }
}

export class GetDocument {
  constructor(private documents: DocumentRepository) {}

  async execute(query: { userId: string; documentId: string }): Promise<DocumentView> {
    const document = await this.documents.findById(query.documentId)
    // Someone else's document is reported as missing, not as forbidden: its existence is not theirs to learn.
    if (!document || document.props.userId !== query.userId)
      throw new NotFoundError('document_not_found', 'Document not found')
    return toView(document)
  }
}

export class ListDocuments {
  constructor(private documents: DocumentRepository) {}

  async execute(query: {
    userId: string
    kind?: DocumentKind
    topUpId?: string
    before?: string
    limit?: number
  }): Promise<{ items: DocumentView[]; nextCursor: string | null }> {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE)
    // One extra row tells us whether there is another page, without a count query.
    const rows = await this.documents.list({
      userId: query.userId,
      kind: query.kind,
      topUpId: query.topUpId,
      before: query.before,
      limit: limit + 1,
    })
    const items = rows.slice(0, limit).map(toView)
    return { items, nextCursor: rows.length > limit ? (items.at(-1)?.id ?? null) : null }
  }
}
