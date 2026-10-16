/** A payment reached an end the provider told us about. Amounts are integers in the currency's smallest unit. */
export interface PaymentOutcomeEvent {
  kind: 'outcome'
  /** The provider's event id. */
  id: string
  outcome: 'succeeded' | 'failed' | 'canceled'
  paymentIntentId: string
  /** The top-up id we put in the payment's metadata, when it carries one. */
  topUpId: string | null
  amount: number
  currency: string
  /** The provider's wording of why a payment was declined. */
  failureReason: string | null
}

/** Money of an already settled top-up moved again: handed back, taken back by the bank, or returned to us. */
export interface PaymentAdjustmentEvent {
  kind: 'adjustment'
  id: string
  adjustment: 'refund' | 'chargeback' | 'chargeback_reversal'
  paymentIntentId: string
  /** The provider's id of the refund or dispute: the same adjustment is booked once. */
  reference: string
  /** Positive: how much moved, whichever way. */
  amount: number
  currency: string
}

export type PaymentEvent = PaymentOutcomeEvent | PaymentAdjustmentEvent

export interface PaymentIntentInput {
  topUpId: string
  userId: string
  currency: string
  amount: number
  /** Asking twice with the same key returns the same payment. */
  idempotencyKey: string
}

export interface PaymentGateway {
  /** Starts a payment the browser then completes with the returned secret. Retrying with the same `idempotencyKey` returns the same payment. */
  createPaymentIntent(input: PaymentIntentInput): Promise<{ id: string; clientSecret: string }>
  /**
   * Where a payment stands at the provider, with the secret to complete it. `outcome` is `null` while the payment is
   * still open (nothing is final yet).
   */
  retrievePayment(
    paymentIntentId: string,
  ): Promise<{ clientSecret: string; outcome: PaymentOutcomeEvent | null }>
  /**
   * Checks the webhook's signature and reads it. Throws `InvalidWebhookError` when the signature does not match;
   * returns `null` for an event this module does not act on.
   */
  parseWebhook(rawBody: string, signature: string | null): Promise<PaymentEvent | null>
}

export class InvalidWebhookError extends Error {}
