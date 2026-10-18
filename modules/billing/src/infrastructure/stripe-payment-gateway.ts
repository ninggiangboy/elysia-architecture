import Stripe from 'stripe'
import {
  InvalidWebhookError,
  type PaymentAdjustmentEvent,
  type PaymentEvent,
  type PaymentGateway,
  type PaymentIntentInput,
  type PaymentOutcomeEvent,
} from '../application/ports'

const OUTCOMES = {
  'payment_intent.succeeded': 'succeeded',
  'payment_intent.payment_failed': 'failed',
  'payment_intent.canceled': 'canceled',
} as const

const idOf = (ref: string | { id: string } | null): string | null =>
  ref === null ? null : typeof ref === 'string' ? ref : ref.id

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
        // Our own card form pays it: cards only. (3-D Secure then comes back through the `return_url` redirect.)
        allowed_payment_method_types: ['card'],
        metadata: { topUpId: input.topUpId, userId: input.userId },
      },
      // The same key never creates a second payment, whatever retries the caller does.
      { idempotencyKey: input.idempotencyKey },
    )
    if (!intent.client_secret) throw new Error('Stripe returned a payment without a client secret')
    return { id: intent.id, clientSecret: intent.client_secret }
  }

  async retrievePayment(paymentIntentId: string) {
    const intent = await this.stripe.paymentIntents.retrieve(paymentIntentId)
    if (!intent.client_secret) throw new Error('Stripe returned a payment without a client secret')
    return {
      clientSecret: intent.client_secret,
      outcome: this.outcomeOf(`retrieve:${intent.id}`, intent),
    }
  }

  /**
   * The webhook endpoint must be subscribed to: `payment_intent.succeeded`, `payment_intent.payment_failed`,
   * `payment_intent.canceled`, `refund.created`, `refund.updated`, `charge.dispute.created`, `charge.dispute.updated` and
   * `charge.dispute.closed` (`scripts/stripe.ts` forwards the same list locally). Set the endpoint's API version in the
   * Dashboard deliberately: it decides the shape of what arrives here, not the SDK's version.
   */
  async parseWebhook(rawBody: string, signature: string | null): Promise<PaymentEvent | null> {
    if (!signature) throw new InvalidWebhookError('missing signature')
    let event: Stripe.Event
    try {
      event = await this.stripe.webhooks.constructEventAsync(rawBody, signature, this.webhookSecret)
    } catch (err) {
      throw new InvalidWebhookError(err instanceof Error ? err.message : 'invalid signature')
    }
    switch (event.type) {
      case 'payment_intent.succeeded':
      case 'payment_intent.payment_failed':
      case 'payment_intent.canceled':
        return this.paymentOutcome(event.id, OUTCOMES[event.type], event.data.object)
      case 'refund.created':
      case 'refund.updated':
        return this.refund(event.id, event.data.object)
      case 'charge.dispute.created':
      case 'charge.dispute.updated':
        return this.dispute(event.id, event.data.object, 'chargeback')
      case 'charge.dispute.closed':
        return this.dispute(event.id, event.data.object, 'chargeback_reversal')
      default:
        return null
    }
  }

  /** What a payment's current state means for a top-up, when it is final enough to mean anything. */
  private outcomeOf(eventId: string, intent: Stripe.PaymentIntent): PaymentOutcomeEvent | null {
    if (intent.status === 'succeeded') return this.paymentOutcome(eventId, 'succeeded', intent)
    if (intent.status === 'canceled') return this.paymentOutcome(eventId, 'canceled', intent)
    if (intent.status === 'requires_payment_method' && intent.last_payment_error)
      return this.paymentOutcome(eventId, 'failed', intent)
    return null
  }

  private paymentOutcome(
    eventId: string,
    outcome: PaymentOutcomeEvent['outcome'],
    intent: Stripe.PaymentIntent,
  ): PaymentOutcomeEvent {
    return {
      kind: 'outcome',
      id: eventId,
      outcome,
      paymentIntentId: intent.id,
      topUpId: intent.metadata?.topUpId ?? null,
      // What was actually charged, so a mismatch with our record is detectable.
      amount: outcome === 'succeeded' ? intent.amount_received : intent.amount,
      currency: intent.currency,
      failureReason: intent.last_payment_error?.message ?? null,
    }
  }

  /** A refund counts once it succeeded; one that is pending, failed or canceled has not moved any money. */
  private refund(eventId: string, refund: Stripe.Refund): PaymentAdjustmentEvent | null {
    const paymentIntentId = idOf(refund.payment_intent)
    if (refund.status !== 'succeeded' || !paymentIntentId) return null
    return {
      kind: 'adjustment',
      id: eventId,
      adjustment: 'refund',
      paymentIntentId,
      reference: refund.id,
      amount: refund.amount,
      currency: refund.currency,
    }
  }

  /**
   * The bank takes the money when a dispute is opened, and gives it back when we win. An inquiry (`warning_*`) takes
   * nothing yet; a dispute that closes any other way than won keeps the money gone.
   */
  private async dispute(
    eventId: string,
    dispute: Stripe.Dispute,
    adjustment: 'chargeback' | 'chargeback_reversal',
  ): Promise<PaymentAdjustmentEvent | null> {
    if (dispute.status.startsWith('warning_')) return null
    const opened = adjustment === 'chargeback' && dispute.status !== 'won'
    const won = adjustment === 'chargeback_reversal' && dispute.status === 'won'
    if (!opened && !won) return null
    const paymentIntentId =
      idOf(dispute.payment_intent) ?? (await this.paymentIntentOfCharge(dispute.charge))
    if (!paymentIntentId) return null
    return {
      kind: 'adjustment',
      id: eventId,
      adjustment,
      paymentIntentId,
      reference: dispute.id,
      amount: dispute.amount,
      currency: dispute.currency,
    }
  }

  private async paymentIntentOfCharge(charge: string | Stripe.Charge): Promise<string | null> {
    const full = typeof charge === 'string' ? await this.stripe.charges.retrieve(charge) : charge
    return idOf(full.payment_intent)
  }
}
