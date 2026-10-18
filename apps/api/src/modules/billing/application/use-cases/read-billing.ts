import type { TopUpStatus } from '@app/shared-types/billing'
import { NotFoundError } from '#/shared/core'
import type { LedgerRepository, TopUpRepository } from '../../domain/billing-repository'
import type { TopUp } from '../../domain/top-up'

export const DEFAULT_PAGE_SIZE = 20
export const MAX_PAGE_SIZE = 50

export interface TransactionView {
  id: string
  type: 'topup'
  status: TopUpStatus
  currency: string
  amount: number
  /** Why a declined payment was declined; `null` otherwise. */
  failureReason: string | null
  createdAt: string
  /** When it last changed state (settled, or declined). */
  updatedAt: string
}

const toView = (topUp: TopUp): TransactionView => ({
  id: topUp.props.id,
  type: 'topup',
  status: topUp.props.status,
  currency: topUp.props.currency,
  amount: topUp.props.amount,
  failureReason: topUp.props.failureReason,
  createdAt: topUp.props.createdAt.toISOString(),
  updatedAt: topUp.props.updatedAt.toISOString(),
})

export class GetWallet {
  constructor(private ledger: LedgerRepository) {}

  async execute(query: {
    userId: string
  }): Promise<{ balances: { currency: string; amount: number }[] }> {
    return { balances: await this.ledger.balances(query.userId) }
  }
}

export class GetTopUp {
  constructor(private topUps: TopUpRepository) {}

  async execute(query: { userId: string; topUpId: string }): Promise<TransactionView> {
    const topUp = await this.topUps.findById(query.topUpId)
    // Someone else's top-up is reported as missing, not as forbidden: its existence is not theirs to learn.
    if (!topUp || topUp.props.userId !== query.userId)
      throw new NotFoundError('topup_not_found', 'Top-up not found')
    return toView(topUp)
  }
}

export class ListTransactions {
  constructor(private topUps: TopUpRepository) {}

  async execute(query: {
    userId: string
    before?: string
    limit?: number
  }): Promise<{ items: TransactionView[]; nextCursor: string | null }> {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE)
    // One extra row tells us whether there is another page, without a count query.
    const rows = await this.topUps.list({
      userId: query.userId,
      before: query.before,
      limit: limit + 1,
    })
    const items = rows.slice(0, limit).map(toView)
    return { items, nextCursor: rows.length > limit ? (items.at(-1)?.id ?? null) : null }
  }
}
