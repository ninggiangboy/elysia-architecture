import type { Clock, IdGenerator, Log, OutboxWriter, UnitOfWork } from '#/shared/application/ports'
import type { LedgerRepository, TopUpRepository } from '../../domain/billing-repository'
import { SETTLEABLE_FROM } from '../../domain/top-up'
import { topUpFailed, topUpSucceeded } from '../billing-events'
import type { PaymentEvent } from '../ports'

export type PaymentEventResult = 'applied' | 'ignored'

/**
 * Applies what the provider says about a payment. The webhook is delivered at least once and in no promised order, so
 * every step is a conditional move: a repeat, or a late "failed" after "succeeded", finds the top-up already settled and
 * changes nothing. Money is added to the wallet in the same transaction that settles the top-up, so it is added once.
 */
export class HandlePaymentEvent {
  constructor(
    private topUps: TopUpRepository,
    private ledger: LedgerRepository,
    private outbox: OutboxWriter,
    private uow: UnitOfWork,
    private ids: IdGenerator,
    private clock: Clock,
    private log: Log,
  ) {}

  async execute(event: PaymentEvent): Promise<PaymentEventResult> {
    const now = this.clock.now()
    return this.uow.run(async () => {
      const topUp = await this.topUps.findByPaymentIntent(event.paymentIntentId)
      if (!topUp) return 'ignored' // not one of ours (or the account was erased)
      const { props } = topUp
      if (props.amount !== event.amount || props.currency !== event.currency) {
        // Never credit an amount we did not ask for. Acknowledge anyway: the provider retrying would not fix it.
        this.log.warn({ eventId: event.id, topUpId: props.id }, 'payment does not match its top-up')
        return 'ignored'
      }

      const settled = await this.topUps.settle(
        props.id,
        SETTLEABLE_FROM[event.outcome],
        event.outcome,
        now,
        event.outcome === 'failed' ? event.failureReason : null,
      )
      if (!settled || !props.userId) return 'ignored'

      if (event.outcome === 'succeeded') {
        const balance = await this.ledger.credit({
          id: this.ids.next(),
          userId: props.userId,
          currency: props.currency,
          amount: props.amount,
          type: 'topup',
          topUpId: props.id,
          createdAt: now,
        })
        await this.outbox.add([
          topUpSucceeded(
            {
              topUpId: props.id,
              userId: props.userId,
              currency: props.currency,
              amount: props.amount,
              balance,
            },
            now,
          ),
        ])
      } else if (event.outcome === 'failed') {
        await this.outbox.add([
          topUpFailed(
            {
              topUpId: props.id,
              userId: props.userId,
              currency: props.currency,
              amount: props.amount,
              reason: event.failureReason,
            },
            now,
          ),
        ])
      }
      return 'applied'
    })
  }
}
