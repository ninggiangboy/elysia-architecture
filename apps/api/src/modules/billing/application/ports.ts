/** What the payment provider told us about a payment. Amounts are integers in the currency's smallest unit. */
export interface PaymentEvent {
  /** The provider's event id, for the logs. */
  id: string
  outcome: 'succeeded' | 'failed' | 'canceled'
  paymentIntentId: string
  amount: number
  currency: string
  /** The provider's wording of why a payment was declined. */
  failureReason: string | null
}

export interface PaymentIntentInput {
  topUpId: string
  userId: string
  currency: string
  amount: number
}

export interface PaymentGateway {
  /** Starts a payment the browser then completes with the returned secret. Retrying with the same `topUpId` returns the same payment. */
  createPaymentIntent(input: PaymentIntentInput): Promise<{ id: string; clientSecret: string }>
  /**
   * Checks the webhook's signature and reads it. Throws `InvalidWebhookError` when the signature does not match;
   * returns `null` for an event this module does not act on.
   */
  parseWebhook(rawBody: string, signature: string | null): Promise<PaymentEvent | null>
}

export class InvalidWebhookError extends Error {}
