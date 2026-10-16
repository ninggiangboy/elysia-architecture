import {
  InvalidWebhookError,
  type PaymentAdjustmentEvent,
  type PaymentEvent,
  type PaymentGateway,
  type PaymentIntentInput,
  type PaymentOutcomeEvent,
} from '../application/ports'

export const FAKE_WEBHOOK_SIGNATURE = 'fake-signature'

/**
 * A payment provider that never leaves the process, for tests: payments are remembered, and a webhook is the JSON of a
 * `PaymentEvent` with the signature `FAKE_WEBHOOK_SIGNATURE`.
 */
export class FakePaymentGateway implements PaymentGateway {
  readonly intents = new Map<string, PaymentIntentInput & { id: string }>()
  /** How a payment ended at the provider, as `retrievePayment` reports it — a test sets it to lose a webhook. */
  readonly ended = new Map<string, PaymentOutcomeEvent['outcome']>()

  async createPaymentIntent(input: PaymentIntentInput) {
    // The provider's idempotency: the same key is the same payment.
    const existing = [...this.intents.values()].find(
      (i) => i.idempotencyKey === input.idempotencyKey,
    )
    // Random, not counted: payments of an earlier run may still be in the database, and the id is unique there.
    const id = existing?.id ?? `pi_fake_${crypto.randomUUID()}`
    if (!existing) this.intents.set(id, { ...input, id })
    return { id, clientSecret: `${id}_secret_fake` }
  }

  async retrievePayment(paymentIntentId: string) {
    const outcome = this.ended.get(paymentIntentId)
    return {
      clientSecret: `${paymentIntentId}_secret_fake`,
      outcome: outcome
        ? this.eventFor(paymentIntentId, outcome, `evt_retrieved_${paymentIntentId}`)
        : null,
    }
  }

  async parseWebhook(rawBody: string, signature: string | null): Promise<PaymentEvent | null> {
    if (signature !== FAKE_WEBHOOK_SIGNATURE) throw new InvalidWebhookError('bad signature')
    const event = JSON.parse(rawBody) as PaymentEvent | { ignore: true }
    return 'ignore' in event ? null : event
  }

  /** The webhook the provider would send once the buyer paid (or failed to pay) a payment made through this gateway. */
  eventFor(
    paymentIntentId: string,
    outcome: PaymentOutcomeEvent['outcome'],
    eventId = `evt_fake_${Math.random().toString(36).slice(2)}`,
  ): PaymentOutcomeEvent {
    const intent = this.intents.get(paymentIntentId)
    if (!intent) throw new Error(`unknown payment ${paymentIntentId}`)
    return {
      kind: 'outcome',
      id: eventId,
      outcome,
      paymentIntentId,
      topUpId: intent.topUpId,
      amount: intent.amount,
      currency: intent.currency,
      failureReason: outcome === 'failed' ? 'Your card was declined.' : null,
    }
  }

  /** The webhook for a refund or a dispute on a payment made through this gateway; `amount` defaults to all of it. */
  adjustmentFor(
    paymentIntentId: string,
    adjustment: PaymentAdjustmentEvent['adjustment'],
    reference: string,
    amount?: number,
    eventId = `evt_fake_${Math.random().toString(36).slice(2)}`,
  ): PaymentAdjustmentEvent {
    const intent = this.intents.get(paymentIntentId)
    if (!intent) throw new Error(`unknown payment ${paymentIntentId}`)
    return {
      kind: 'adjustment',
      id: eventId,
      adjustment,
      paymentIntentId,
      reference,
      amount: amount ?? intent.amount,
      currency: intent.currency,
    }
  }
}
