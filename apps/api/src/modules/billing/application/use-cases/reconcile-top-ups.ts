import type { Clock, Log } from '#/shared/application/ports'
import type { TopUpRepository } from '../../domain/billing-repository'
import type { PaymentGateway } from '../ports'
import type { HandlePaymentEvent } from './handle-payment-event'

export interface ReconcilePolicy {
  /** A payment younger than this is left to its webhook; an open one is asked about again after this long. */
  settleGraceMs: number
  /** Payments older than this are given up on: a buyer who never paid. */
  giveUpAfterMs: number
  batchSize: number
}

/**
 * The webhook is how a payment settles, but it can be lost (the endpoint was down for days, the signing secret was
 * wrong). This asks the provider about payments that are still open and feeds the answer through the same path as the
 * webhook, so it can never credit anything the webhook would not, and a payment that settles both ways is credited once.
 */
export class ReconcileTopUps {
  constructor(
    private topUps: TopUpRepository,
    private gateway: PaymentGateway,
    private handle: HandlePaymentEvent,
    private policy: ReconcilePolicy,
    private clock: Clock,
    private log: Log,
  ) {}

  /** One pass over what is due; returns how many top-ups it settled. */
  async runOnce(): Promise<number> {
    const now = this.clock.now()
    const due = await this.topUps.claimForReconciliation({
      createdBefore: new Date(now.getTime() - this.policy.settleGraceMs),
      createdAfter: new Date(now.getTime() - this.policy.giveUpAfterMs),
      checkedBefore: new Date(now.getTime() - this.policy.settleGraceMs),
      limit: this.policy.batchSize,
      now,
    })
    let settled = 0
    for (const topUp of due) {
      try {
        const { outcome } = await this.gateway.retrievePayment(topUp.props.paymentIntentId)
        if (!outcome) continue
        // A stable id, so the audit trail shows one row for the payment however many passes saw it.
        const result = await this.handle.execute({
          ...outcome,
          id: `reconcile:${topUp.props.paymentIntentId}:${outcome.outcome}`,
        })
        if (result === 'applied') {
          settled++
          this.log.warn(
            { topUpId: topUp.id, outcome: outcome.outcome },
            'settled a top-up whose webhook never arrived',
          )
        }
      } catch (err) {
        // One bad payment must not stop the others; it is asked about again after the grace period.
        this.log.error({ err, topUpId: topUp.id }, 'could not reconcile a top-up')
      }
    }
    return settled
  }
}
