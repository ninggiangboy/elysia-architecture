import type { IdGenerator } from '@kit/core'
import type { DocumentRepository } from '../domain/billing-repository'
import {
  BillingDocument,
  type BillingDocumentProps,
  type DocumentKind,
  documentNumber,
  EMPTY_PARTY,
  type Party,
  topUpLine,
} from '../domain/document'
import type { TopUp } from '../domain/top-up'
import type { BuyerDetails, BuyerDirectory, PaymentAdjustmentEvent } from './ports'

const clean = (value: string | undefined) => value?.trim() || null

/**
 * Issues the documents of a top-up: an invoice when it starts, a receipt when it is paid, a credit note when money
 * is handed back. Every method that writes must run inside the unit of work of the money movement it documents, so
 * that a number is never used without its document and the document exists exactly when the money moved.
 *
 * Each is safe to repeat: a document is issued once per top-up (invoice, receipt) or per refund or dispute (credit
 * note), and the number is only taken when one is stored, so numbers stay consecutive.
 */
export class DocumentIssuer {
  constructor(
    private documents: DocumentRepository,
    private seller: Party,
    private buyers: BuyerDirectory,
    private ids: IdGenerator,
  ) {}

  /** Who is billed. Reads other modules, so call it before the transaction, not inside it. */
  async buyerFor(userId: string, details?: BuyerDetails): Promise<Party> {
    const known = await this.buyers.lookup(userId)
    return {
      name: clean(details?.name) ?? known.name,
      email: known.email,
      address: clean(details?.address),
      taxId: clean(details?.taxId),
    }
  }

  async issueInvoice(
    topUp: TopUp,
    buyer: Party,
    now: Date,
    status: 'open' | 'paid' = 'open',
  ): Promise<BillingDocument> {
    const existing = await this.documents.findForTopUp(topUp.id, 'invoice')
    if (existing) return existing
    return this.store('invoice', now, {
      status,
      topUpId: topUp.id,
      userId: topUp.props.userId,
      currency: topUp.props.currency,
      amount: topUp.props.amount,
      invoiceId: null,
      reference: null,
      seller: this.seller,
      buyer,
      lines: [topUpLine(topUp.props.amount)],
      settledAt: status === 'paid' ? now : null,
    })
  }

  /** The payment succeeded: the invoice is paid, and the receipt says so. */
  async paid(topUp: TopUp, now: Date): Promise<void> {
    const invoice =
      (await this.documents.settleInvoice(topUp.id, ['open'], 'paid', now)) ??
      (await this.documents.findForTopUp(topUp.id, 'invoice')) ??
      // A top-up that started before invoices existed: bill it now, already paid. Nobody is looked up (other modules
      // are not called inside a transaction), so the buyer is blank.
      (await this.issueInvoice(topUp, EMPTY_PARTY, now, 'paid'))
    if (await this.documents.findForTopUp(topUp.id, 'receipt')) return
    await this.store('receipt', now, {
      status: 'issued',
      topUpId: topUp.id,
      userId: topUp.props.userId,
      currency: invoice.props.currency,
      amount: invoice.props.amount,
      invoiceId: invoice.id,
      reference: null,
      seller: invoice.props.seller,
      buyer: invoice.props.buyer,
      lines: invoice.props.lines,
      settledAt: null,
    })
  }

  /** The payment was canceled: nobody is going to pay the invoice. */
  async canceled(topUp: TopUp, now: Date): Promise<void> {
    await this.documents.settleInvoice(topUp.id, ['open'], 'void', now)
  }

  /** A refund or a dispute took money back: the credit note says how much, against which invoice. */
  async creditNote(
    topUp: TopUp,
    event: Pick<PaymentAdjustmentEvent, 'adjustment' | 'reference' | 'amount'>,
    now: Date,
  ): Promise<void> {
    if (await this.documents.findByReference('credit_note', event.reference)) return
    const invoice = await this.documents.findForTopUp(topUp.id, 'invoice')
    await this.store('credit_note', now, {
      status: 'issued',
      topUpId: topUp.id,
      userId: topUp.props.userId,
      currency: topUp.props.currency,
      amount: event.amount,
      invoiceId: invoice?.id ?? null,
      reference: event.reference,
      seller: invoice?.props.seller ?? this.seller,
      buyer: invoice?.props.buyer ?? EMPTY_PARTY,
      lines: [
        {
          description: event.adjustment === 'refund' ? 'Refund of wallet top-up' : 'Chargeback',
          quantity: 1,
          unitAmount: event.amount,
          amount: event.amount,
        },
      ],
      settledAt: null,
    })
  }

  /** The dispute was won and the bank returned the money: the credit note no longer stands. */
  async voidCreditNote(reference: string, now: Date): Promise<void> {
    await this.documents.voidCreditNote(reference, now)
  }

  private async store(
    kind: DocumentKind,
    now: Date,
    fields: Omit<BillingDocumentProps, 'id' | 'kind' | 'number' | 'issuedAt'>,
  ): Promise<BillingDocument> {
    const sequence = await this.documents.nextSequence(kind, now.getUTCFullYear())
    const document = BillingDocument.issue({
      ...fields,
      id: this.ids.next(),
      kind,
      number: documentNumber(kind, now.getUTCFullYear(), sequence),
      issuedAt: now,
    })
    await this.documents.insert(document)
    return document
  }
}
