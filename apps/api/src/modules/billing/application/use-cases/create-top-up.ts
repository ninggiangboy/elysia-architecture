import { ConflictError, NotFoundError } from '#/shared/application/errors'
import type { Clock, IdGenerator } from '#/shared/application/ports'
import type { TopUpRepository } from '../../domain/billing-repository'
import { TopUp } from '../../domain/top-up'
import type { CurrencyPolicy } from '../currency-policy'
import type { PaymentGateway } from '../ports'

export class CreateTopUp {
  constructor(
    private currencies: CurrencyPolicy,
    /** `undefined` = payments are not configured on this deployment. */
    private gateway: PaymentGateway | undefined,
    private topUps: TopUpRepository,
    private ids: IdGenerator,
    private clock: Clock,
  ) {}

  /**
   * With an `idempotencyKey` (the client's `Idempotency-Key`), starting the same top-up again — a double click, a retry
   * after a timeout — returns the first one instead of opening a second payment. Without one, every call is a new top-up.
   */
  async execute(cmd: {
    userId: string
    currency: string
    amount: number
    idempotencyKey?: string
  }): Promise<{ topUpId: string; clientSecret: string }> {
    const gateway = this.gateway
    if (!gateway) throw new NotFoundError('billing_disabled', 'Top-ups are not available')
    const currency = cmd.currency.toLowerCase()
    this.currencies.assertAllowed(currency, cmd.amount)
    const key = cmd.idempotencyKey

    if (key) {
      const earlier = await this.topUps.findByIdempotencyKey(cmd.userId, key)
      if (earlier) return this.replay(gateway, earlier, currency, cmd.amount)
    }

    const topUpId = this.ids.next()
    const intent = await gateway.createPaymentIntent({
      topUpId,
      userId: cmd.userId,
      currency,
      amount: cmd.amount,
      // Scoped to the user: another user's identical key must not hand them this payment.
      idempotencyKey: key ? `topup-${cmd.userId}-${key}` : `topup-${topUpId}`,
    })
    const stored = await this.topUps.insert(
      TopUp.create({
        id: topUpId,
        userId: cmd.userId,
        currency,
        amount: cmd.amount,
        paymentIntentId: intent.id,
        idempotencyKey: key ?? null,
        now: this.clock.now(),
      }),
    )
    if (stored) return { topUpId, clientSecret: intent.clientSecret }

    // A request with the same key got there first (both reached the provider, which returned one payment to both).
    const winner = key ? await this.topUps.findByIdempotencyKey(cmd.userId, key) : null
    if (!winner) throw new Error('the top-up could not be stored')
    return this.replay(gateway, winner, currency, cmd.amount)
  }

  private async replay(gateway: PaymentGateway, earlier: TopUp, currency: string, amount: number) {
    // The key stands for one request: reusing it for another amount is a bug in the client, not a retry.
    if (earlier.props.currency !== currency || earlier.props.amount !== amount)
      throw new ConflictError(
        'idempotency_key_reused',
        'This Idempotency-Key was already used for a different top-up',
      )
    const { clientSecret } = await gateway.retrievePayment(earlier.props.paymentIntentId)
    return { topUpId: earlier.id, clientSecret }
  }
}
