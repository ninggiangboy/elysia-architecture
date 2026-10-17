import type { BillingDocument, DocumentKind, DocumentStatus } from './document'
import type { TopUp, TopUpStatus } from './top-up'

/**
 * `topup` is money in. The others adjust a settled top-up after the fact and carry the provider's id of the refund or
 * dispute in `reference`: `refund` (money handed back to the buyer), `chargeback` (the bank took it back) and
 * `chargeback_reversal` (the dispute was won, so the bank returned it).
 */
export type LedgerEntryType = 'topup' | 'refund' | 'chargeback' | 'chargeback_reversal'

export interface LedgerEntryRecord {
  id: string
  userId: string | null
  currency: string
  /** Positive = money in, negative = money out. */
  amount: number
  type: LedgerEntryType
  topUpId: string
  /** The provider's refund or dispute id; `null` for `topup`. */
  reference: string | null
  createdAt: Date
}

export interface Balance {
  currency: string
  amount: number
}

export interface TopUpRepository {
  /**
   * Stores the top-up. `false` when it was not stored because the client's idempotency key was already used for a
   * top-up of the same user — the caller then finds that one with `findByIdempotencyKey`.
   */
  insert(topUp: TopUp): Promise<boolean>
  findById(id: string): Promise<TopUp | null>
  /** The user's top-up that was started with this idempotency key. */
  findByIdempotencyKey(userId: string, key: string): Promise<TopUp | null>
  /** Locks the row for the rest of the transaction, so two deliveries of one event are handled one after the other. */
  findByPaymentIntent(paymentIntentId: string): Promise<TopUp | null>
  /**
   * Moves the top-up to `to` only if it is currently in one of `from`. Returns it as it now is, or `null` when it was
   * not in a state to move (already settled, or does not exist) — the caller treats that as "nothing to do".
   */
  settle(
    id: string,
    from: readonly TopUpStatus[],
    to: TopUpStatus,
    now: Date,
    failureReason?: string | null,
  ): Promise<TopUp | null>
  /**
   * Hands out payments that are still open (`pending`, or `failed` and retryable) and were created in the window, and
   * stamps them so nobody else — another instance, the next pass — takes them again before `checkedBefore`.
   */
  claimForReconciliation(query: {
    createdBefore: Date
    createdAfter: Date
    checkedBefore: Date
    limit: number
    now: Date
  }): Promise<TopUp[]>
  /** Newest first. `before` is the id of the last item of the previous page. */
  list(query: { userId: string; before?: string; limit: number }): Promise<TopUp[]>
}

export interface LedgerRepository {
  /**
   * Appends the entry and adds its (signed) amount to the owner's balance; returns the balance after, or `null` when
   * the entry was already booked (same top-up, or same refund or dispute) and nothing changed. Call inside a unit of work.
   */
  post(entry: LedgerEntryRecord & { userId: string }): Promise<number | null>
  /** Whether an entry of this type was already booked for this refund or dispute. */
  hasReference(type: LedgerEntryType, reference: string): Promise<boolean>
  balances(userId: string): Promise<Balance[]>
  /** Everything the user has in the ledger, oldest first, for a data export. */
  entries(userId: string): Promise<LedgerEntryRecord[]>
}

export type AnomalyKind =
  /** The provider charged an amount (or currency) other than the one the top-up asked for: nothing was credited. */
  | 'amount_mismatch'
  /** The payment succeeded after the account was erased: the money has no wallet to go to. */
  | 'paid_after_erasure'
  /** The provider says a payment of ours happened, but there is no such top-up. */
  | 'unknown_payment'
  /** A refund or a dispute took a balance below zero. */
  | 'negative_balance'
  /** A refund or a dispute does not fit the top-up it names (another currency). */
  | 'adjustment_mismatch'

/** What the webhook handling leaves behind for people: an audit row per event, and an alert per payment gone wrong. */
export interface PaymentAuditRepository {
  /** One row per provider event; a repeated delivery only counts up. */
  recordEvent(event: {
    id: string
    paymentIntentId: string
    result: string
    now: Date
  }): Promise<void>
  /** At most one per payment and kind, however often the event is delivered. */
  recordAnomaly(anomaly: {
    id: string
    kind: AnomalyKind
    paymentIntentId: string
    topUpId: string | null
    eventId: string
    detail: string
    now: Date
  }): Promise<void>
}

export interface DocumentRepository {
  /**
   * The next number of this kind in this year (1, 2, 3 …). It locks the counter until the transaction ends, so numbers
   * are consecutive: call it inside the unit of work that stores the document, and only when one will be stored.
   */
  nextSequence(kind: DocumentKind, year: number): Promise<number>
  insert(document: BillingDocument): Promise<void>
  findById(id: string): Promise<BillingDocument | null>
  /** The invoice or receipt of a top-up (a top-up has at most one of each). */
  findForTopUp(topUpId: string, kind: 'invoice' | 'receipt'): Promise<BillingDocument | null>
  /** The credit note for this refund or dispute. */
  findByReference(kind: 'credit_note', reference: string): Promise<BillingDocument | null>
  /**
   * Moves the top-up's invoice to `to` only if it is currently in one of `from`. Returns it as it now is, or `null` when
   * it was not in a state to move (already settled, or there is none).
   */
  settleInvoice(
    topUpId: string,
    from: readonly DocumentStatus[],
    to: DocumentStatus,
    now: Date,
  ): Promise<BillingDocument | null>
  /** Voids the credit note booked for this dispute, if it is still issued. */
  voidCreditNote(reference: string, now: Date): Promise<BillingDocument | null>
  /** Newest first. `before` is the id of the last item of the previous page. */
  list(query: {
    userId: string
    kind?: DocumentKind
    topUpId?: string
    before?: string
    limit: number
  }): Promise<BillingDocument[]>
}
