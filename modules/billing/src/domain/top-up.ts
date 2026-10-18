import { DomainError } from '@kit/core'
import type { TopUpStatus } from '../public'

export type { TopUpStatus }

class InvalidTopUpError extends DomainError {
  constructor(message: string) {
    super('invalid_topup', message, 'validation')
  }
}

export interface TopUpProps {
  id: string
  /** `null` once the account is erased: the record is kept as a financial document, without the person. */
  userId: string | null
  /** ISO 4217, lower case (`usd`). */
  currency: string
  /** Integer, in the currency's smallest unit. */
  amount: number
  status: TopUpStatus
  paymentIntentId: string
  /** Why the last attempt was declined, as the provider words it; `null` unless `failed`. */
  failureReason: string | null
  /** The client's `Idempotency-Key` for starting this top-up; `null` when it sent none. */
  idempotencyKey: string | null
  /** When the reconciliation job last asked the provider about this payment; `null` = never. */
  reconciledAt: Date | null
  createdAt: Date
  updatedAt: Date
}

/**
 * One attempt to add money to a wallet. It is created `pending` together with the provider's payment, and the
 * provider's webhook settles it. A declined card leaves it `failed`, but the same payment can still be completed with
 * another method — so `failed` can become `succeeded`; `succeeded` and `canceled` are final.
 */
export class TopUp {
  private constructor(readonly props: TopUpProps) {}

  static create(input: {
    id: string
    userId: string
    currency: string
    amount: number
    paymentIntentId: string
    idempotencyKey?: string | null
    now: Date
  }): TopUp {
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0)
      throw new InvalidTopUpError('amount must be a positive integer')
    return new TopUp({
      id: input.id,
      userId: input.userId,
      currency: input.currency,
      amount: input.amount,
      paymentIntentId: input.paymentIntentId,
      status: 'pending',
      failureReason: null,
      idempotencyKey: input.idempotencyKey ?? null,
      reconciledAt: null,
      createdAt: input.now,
      updatedAt: input.now,
    })
  }

  static restore(props: TopUpProps): TopUp {
    return new TopUp(props)
  }

  get id() {
    return this.props.id
  }
}

/** The statuses a top-up may be settled from. The repository applies these as a conditional update. */
export const SETTLEABLE_FROM = {
  succeeded: ['pending', 'failed'],
  failed: ['pending'],
  canceled: ['pending', 'failed'],
} as const satisfies Record<'succeeded' | 'failed' | 'canceled', readonly TopUpStatus[]>
