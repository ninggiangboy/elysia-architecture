import Stripe from 'stripe'
import {
  InvalidWebhookError,
  type PaymentEvent,
  type PaymentGateway,
  type PaymentIntentInput,
} from '../application/ports'

const OUTCOMES = {
  'payment_intent.succeeded': 'succeeded',
  'payment_intent.payment_failed': 'failed',
  'payment_intent.canceled': 'canceled',
} as const

export class StripePaymentGateway implements PaymentGateway {
  private readonly stripe: Stripe

  constructor(
    secretKey: string,
    private webhookSecret: string,
  ) {
    this.stripe = new Stripe(secretKey, { httpClient: Stripe.createFetchHttpClient() })
  }

  async createPaymentIntent(input: PaymentIntentInput) {
    const intent = await this.stripe.paymentIntents.create(
      {
        amount: input.amount,
        currency: input.currency,
        automatic_payment_methods: { enabled: true },
        metadata: { topUpId: input.topUpId, userId: input.userId },
      },
      // The same top-up never creates a second payment, whatever retries the caller does.
      { idempotencyKey: `topup-${input.topUpId}` },
    )
    if (!intent.client_secret) throw new Error('Stripe returned a payment without a client secret')
    return { id: intent.id, clientSecret: intent.client_secret }
  }

  async parseWebhook(rawBody: string, signature: string | null): Promise<PaymentEvent | null> {
    if (!signature) throw new InvalidWebhookError('missing signature')
    let event: Stripe.Event
    try {
      event = await this.stripe.webhooks.constructEventAsync(rawBody, signature, this.webhookSecret)
    } catch (err) {
      throw new InvalidWebhookError(err instanceof Error ? err.message : 'invalid signature')
    }
    const outcome = OUTCOMES[event.type as keyof typeof OUTCOMES]
    if (!outcome) return null
    const intent = event.data.object as Stripe.PaymentIntent
    return {
      id: event.id,
      outcome,
      paymentIntentId: intent.id,
      // For a successful payment this is what was charged, so a mismatch with our record is detectable.
      amount: intent.amount,
      currency: intent.currency,
      failureReason: intent.last_payment_error?.message ?? null,
    }
  }
}
