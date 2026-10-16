import { NotFoundError } from '#/shared/application/errors'
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

  async execute(cmd: {
    userId: string
    currency: string
    amount: number
  }): Promise<{ topUpId: string; clientSecret: string }> {
    if (!this.gateway) throw new NotFoundError('billing_disabled', 'Top-ups are not available')
    const currency = cmd.currency.toLowerCase()
    this.currencies.assertAllowed(currency, cmd.amount)

    const topUpId = this.ids.next()
    const intent = await this.gateway.createPaymentIntent({
      topUpId,
      userId: cmd.userId,
      currency,
      amount: cmd.amount,
    })
    await this.topUps.insert(
      TopUp.create({
        id: topUpId,
        userId: cmd.userId,
        currency,
        amount: cmd.amount,
        paymentIntentId: intent.id,
        now: this.clock.now(),
      }),
    )
    return { topUpId, clientSecret: intent.clientSecret }
  }
}
