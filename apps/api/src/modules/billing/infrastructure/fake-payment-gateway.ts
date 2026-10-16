import {
  InvalidWebhookError,
  type PaymentEvent,
  type PaymentGateway,
  type PaymentIntentInput,
} from '../application/ports'

export const FAKE_WEBHOOK_SIGNATURE = 'fake-signature'

/**
 * A payment provider that never leaves the process, for tests: payments are remembered, and a webhook is the JSON of a
 * `PaymentEvent` with the signature `FAKE_WEBHOOK_SIGNATURE`.
 */
export class FakePaymentGateway implements PaymentGateway {
  readonly intents = new Map<string, PaymentIntentInput & { id: string }>()

  async createPaymentIntent(input: PaymentIntentInput) {
    const existing = [...this.intents.values()].find((i) => i.topUpId === input.topUpId)
    // Random, not counted: payments of an earlier run may still be in the database, and the id is unique there.
    const id = existing?.id ?? `pi_fake_${crypto.randomUUID()}`
    this.intents.set(id, { ...input, id })
    return { id, clientSecret: `${id}_secret_fake` }
  }

  async parseWebhook(rawBody: string, signature: string | null): Promise<PaymentEvent | null> {
    if (signature !== FAKE_WEBHOOK_SIGNATURE) throw new InvalidWebhookError('bad signature')
    const event = JSON.parse(rawBody) as PaymentEvent | { ignore: true }
    return 'ignore' in event ? null : event
  }

  /** The webhook the provider would send once the buyer paid (or failed to pay) a payment made through this gateway. */
  eventFor(
    paymentIntentId: string,
    outcome: PaymentEvent['outcome'],
    eventId = `evt_fake_${Math.random().toString(36).slice(2)}`,
  ): PaymentEvent {
    const intent = this.intents.get(paymentIntentId)
    if (!intent) throw new Error(`unknown payment ${paymentIntentId}`)
    return {
      id: eventId,
      outcome,
      paymentIntentId,
      amount: intent.amount,
      currency: intent.currency,
      failureReason: outcome === 'failed' ? 'Your card was declined.' : null,
    }
  }
}
