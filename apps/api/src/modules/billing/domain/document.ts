import type { DocumentKind, DocumentStatus } from '@app/shared-types/billing'
import { DomainError } from '@kit/core'

export type { DocumentKind, DocumentStatus }

class InvalidDocumentError extends DomainError {
  constructor(message: string) {
    super('invalid_document', message, 'validation')
  }
}

/** Who a document is between. Frozen into the document when it is issued: later edits to a profile do not change it. */
export interface Party {
  name: string | null
  email: string | null
  address: string | null
  /** VAT number, MST or the like. */
  taxId: string | null
}

export interface DocumentLine {
  description: string
  quantity: number
  /** Integer, in the currency's smallest unit. */
  unitAmount: number
  /** `quantity * unitAmount`. */
  amount: number
}

export interface BillingDocumentProps {
  id: string
  kind: DocumentKind
  /** `INV-2026-000001`: per kind and year, consecutive. */
  number: string
  status: DocumentStatus
  topUpId: string
  /** `null` once the account is erased: the document is kept without the person. */
  userId: string | null
  /** ISO 4217, lower case. */
  currency: string
  /** Integer, in the currency's smallest unit; always positive (a credit note is a positive amount handed back). */
  amount: number
  /** The invoice a receipt or a credit note belongs to. */
  invoiceId: string | null
  /** The provider's refund or dispute id behind a credit note. */
  reference: string | null
  seller: Party
  buyer: Party
  lines: DocumentLine[]
  issuedAt: Date
  /** When an invoice was paid or voided, or a credit note voided; `null` while nothing happened since issuing. */
  settledAt: Date | null
}

const PREFIX: Record<DocumentKind, string> = { invoice: 'INV', receipt: 'RCT', credit_note: 'CN' }

export const documentNumber = (kind: DocumentKind, year: number, sequence: number) =>
  `${PREFIX[kind]}-${year}-${String(sequence).padStart(6, '0')}`

/**
 * A numbered, immutable record of money asked for (invoice), received (receipt) or handed back (credit note). Only the
 * status of an invoice or a credit note moves after issuing; everything else is a snapshot of the moment it was issued.
 */
export class BillingDocument {
  private constructor(readonly props: BillingDocumentProps) {}

  static issue(input: Omit<BillingDocumentProps, 'settledAt'> & { settledAt?: Date | null }) {
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0)
      throw new InvalidDocumentError('amount must be a positive integer')
    if (input.lines.reduce((sum, l) => sum + l.amount, 0) !== input.amount)
      throw new InvalidDocumentError('the lines must add up to the amount')
    return new BillingDocument({ ...input, settledAt: input.settledAt ?? null })
  }

  static restore(props: BillingDocumentProps): BillingDocument {
    return new BillingDocument(props)
  }

  get id() {
    return this.props.id
  }
}

export const EMPTY_PARTY: Party = { name: null, email: null, address: null, taxId: null }

/** The single line a top-up is billed as. */
export const topUpLine = (amount: number): DocumentLine => ({
  description: 'Wallet top-up',
  quantity: 1,
  unitAmount: amount,
  amount,
})
