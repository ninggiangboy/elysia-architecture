import type { TopUp, TopUpStatus } from './top-up'

export interface LedgerEntryRecord {
  id: string
  userId: string | null
  currency: string
  /** Positive = money in. */
  amount: number
  type: 'topup'
  topUpId: string
  createdAt: Date
}

export interface Balance {
  currency: string
  amount: number
}

export interface TopUpRepository {
  insert(topUp: TopUp): Promise<void>
  findById(id: string): Promise<TopUp | null>
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
  /** Newest first. `before` is the id of the last item of the previous page. */
  list(query: { userId: string; before?: string; limit: number }): Promise<TopUp[]>
}

export interface LedgerRepository {
  /** Appends the entry and adds its amount to the owner's balance; returns the balance after. Call inside a unit of work. */
  credit(entry: LedgerEntryRecord & { userId: string }): Promise<number>
  balances(userId: string): Promise<Balance[]>
  /** Everything the user has in the ledger, oldest first, for a data export. */
  entries(userId: string): Promise<LedgerEntryRecord[]>
}
