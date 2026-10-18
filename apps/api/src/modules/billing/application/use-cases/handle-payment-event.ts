import type { Clock, IdGenerator, Log, UnitOfWork } from '#/shared/core'
import type { OutboxWriter } from '#/shared/messaging'
import type {
  AnomalyKind,
  LedgerEntryType,
  LedgerRepository,
  PaymentAuditRepository,
  TopUpRepository,
} from '../../domain/billing-repository'
import { SETTLEABLE_FROM } from '../../domain/top-up'
import { topUpFailed, topUpSucceeded } from '../billing-events'
import type { DocumentIssuer } from '../document-issuer'
import type { PaymentAdjustmentEvent, PaymentEvent, PaymentOutcomeEvent } from '../ports'

/**
 * `applied`: it changed something. `ignored`: nothing to do (a repeat, not ours, or refused). `deferred`: it cannot be
 * applied *yet* because it arrived ahead of the event it depends on; the provider should deliver it again later.
 */
export type PaymentEventResult = 'applied' | 'ignored' | 'deferred'

/** Which way each adjustment moves a wallet. */
const SIGN: Record<PaymentAdjustmentEvent['adjustment'], 1 | -1> = {
  refund: -1,
  chargeback: -1,
  chargeback_reversal: 1,
}

/**
 * Applies what the provider says about a payment. The webhook is delivered at least once and in no promised order, so
 * every step is a conditional move: a repeat, or a late "failed" after "succeeded", finds the top-up already settled and
 * changes nothing. Money is added to the wallet in the same transaction that settles the top-up, so it is added once.
 * Refunds and disputes are booked once per provider id (unique in the ledger) in the same way. The documents
 * (receipt, credit note) are issued in that same transaction, so a wallet never moves without its paper.
 *
 * Whatever happens, the event is written to the audit trail; money that cannot be explained becomes an anomaly.
 */
export class HandlePaymentEvent {
  constructor(
    private topUps: TopUpRepository,
    private ledger: LedgerRepository,
    private audit: PaymentAuditRepository,
    private outbox: OutboxWriter,
    private uow: UnitOfWork,
    private ids: IdGenerator,
    private clock: Clock,
    private log: Log,
    private documents: DocumentIssuer,
  ) {}

  async execute(event: PaymentEvent): Promise<PaymentEventResult> {
    const now = this.clock.now()
    return this.uow.run(async () => {
      const result =
        event.kind === 'outcome'
          ? await this.applyOutcome(event, now)
          : await this.applyAdjustment(event, now)
      await this.audit.recordEvent({
        id: event.id,
        paymentIntentId: event.paymentIntentId,
        result,
        now,
      })
      return result
    })
  }

  private async applyOutcome(event: PaymentOutcomeEvent, now: Date): Promise<PaymentEventResult> {
    const topUp = await this.topUps.findByPaymentIntent(event.paymentIntentId)
    if (!topUp) {
      // Not one of ours (the Stripe account may serve other things) — unless it says it is, then someone must look.
      if (event.topUpId && event.outcome === 'succeeded')
        await this.anomaly(
          'unknown_payment',
          event,
          null,
          `no top-up ${event.topUpId} for a payment`,
          now,
        )
      return 'ignored'
    }
    const { props } = topUp
    if (props.amount !== event.amount || props.currency !== event.currency) {
      // Never credit an amount we did not ask for. Acknowledge anyway: the provider retrying would not fix it.
      const detail = `asked ${props.amount} ${props.currency}, provider says ${event.amount} ${event.currency}`
      if (event.outcome === 'succeeded')
        await this.anomaly('amount_mismatch', event, props.id, detail, now)
      else
        this.log.warn(
          { eventId: event.id, topUpId: props.id },
          `payment does not match its top-up: ${detail}`,
        )
      return 'ignored'
    }

    const settled = await this.topUps.settle(
      props.id,
      SETTLEABLE_FROM[event.outcome],
      event.outcome,
      now,
      event.outcome === 'failed' ? event.failureReason : null,
    )
    if (!settled) return 'ignored'
    if (event.outcome === 'canceled') await this.documents.canceled(topUp, now)
    if (!props.userId) {
      if (event.outcome === 'succeeded')
        await this.anomaly(
          'paid_after_erasure',
          event,
          props.id,
          'paid after the account was erased',
          now,
        )
      return 'ignored'
    }

    if (event.outcome === 'succeeded') {
      const balance = await this.ledger.post({
        id: this.ids.next(),
        userId: props.userId,
        currency: props.currency,
        amount: props.amount,
        type: 'topup',
        topUpId: props.id,
        reference: null,
        createdAt: now,
      })
      if (balance === null) return 'ignored'
      await this.documents.paid(topUp, now)
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
  }

  private async applyAdjustment(
    event: PaymentAdjustmentEvent,
    now: Date,
  ): Promise<PaymentEventResult> {
    const topUp = await this.topUps.findByPaymentIntent(event.paymentIntentId)
    if (!topUp) return 'ignored' // not one of ours
    const { props } = topUp
    // Money can only be taken back from a top-up that was credited. If its "succeeded" has not been applied yet (the
    // events came out of order, or one was lost), say "not yet": the provider delivers again, or reconciliation settles it.
    if (props.status === 'pending' || props.status === 'failed') return 'deferred'
    if (props.status === 'canceled' || !props.userId) return 'ignored'
    if (props.currency !== event.currency) {
      await this.anomaly(
        'adjustment_mismatch',
        event,
        props.id,
        `${event.adjustment} in ${event.currency} on a top-up in ${props.currency}`,
        now,
      )
      return 'ignored'
    }
    // Winning a dispute returns what the dispute took. If the taking has not been booked yet (its "created" is late),
    // there is nothing to return: say "not yet", and the reversal applies when it is delivered again.
    if (
      event.adjustment === 'chargeback_reversal' &&
      !(await this.ledger.hasReference('chargeback', event.reference))
    )
      return 'deferred'

    const type: LedgerEntryType = event.adjustment
    const balance = await this.ledger.post({
      id: this.ids.next(),
      userId: props.userId,
      currency: props.currency,
      amount: SIGN[event.adjustment] * event.amount,
      type,
      topUpId: props.id,
      reference: event.reference,
      createdAt: now,
    })
    if (balance === null) return 'ignored'
    if (event.adjustment === 'chargeback_reversal')
      await this.documents.voidCreditNote(event.reference, now)
    else await this.documents.creditNote(topUp, event, now)
    if (balance < 0)
      await this.anomaly(
        'negative_balance',
        event,
        props.id,
        `balance is ${balance} ${props.currency} after ${event.adjustment}`,
        now,
      )
    return 'applied'
  }

  /** Writes the alert and shouts in the log: the money moved and no wallet explains it. */
  private async anomaly(
    kind: AnomalyKind,
    event: PaymentEvent,
    topUpId: string | null,
    detail: string,
    now: Date,
  ) {
    this.log.error(
      { kind, eventId: event.id, paymentIntentId: event.paymentIntentId, topUpId },
      `payment needs attention: ${detail}`,
    )
    await this.audit.recordAnomaly({
      id: this.ids.next(),
      kind,
      paymentIntentId: event.paymentIntentId,
      topUpId,
      eventId: event.id,
      detail,
      now,
    })
  }
}
