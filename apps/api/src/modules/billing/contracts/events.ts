export const BillingEvents = {
  TopUpSucceeded: 'billing.topup_succeeded.v1',
  TopUpFailed: 'billing.topup_failed.v1',
  /** Answers to the privacy module's requests (see `privacy/contracts`). */
  DataExported: 'billing.data_exported.v1',
  UserDataErased: 'billing.user_data_erased.v1',
} as const

/** The money reached the wallet. Amounts are integers in the currency's smallest unit. */
export interface TopUpSucceededPayload {
  topUpId: string
  userId: string
  currency: string
  amount: number
  /** The wallet's balance in this currency after the top-up. */
  balance: number
  succeededAt: string
}

/** The payment was declined. The user may try again with another method on the same top-up. */
export interface TopUpFailedPayload {
  topUpId: string
  userId: string
  currency: string
  amount: number
  reason: string | null
  failedAt: string
}
