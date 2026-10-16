import { beforeEach, describe, expect, test } from 'bun:test'
import {
  FakeClock,
  InMemoryOutbox,
  PassthroughUnitOfWork,
  SequentialIds,
} from '#/shared/testing/fakes'
import { BillingEvents } from '../contracts/events'
import type {
  AnomalyKind,
  Balance,
  LedgerEntryRecord,
  LedgerEntryType,
  LedgerRepository,
  PaymentAuditRepository,
  TopUpRepository,
} from '../domain/billing-repository'
import { TopUp, type TopUpStatus } from '../domain/top-up'
import { FakePaymentGateway } from '../infrastructure/fake-payment-gateway'
import { BillingDataExporter } from './billing-data-exporter'
import { CurrencyPolicy } from './currency-policy'
import { CreateTopUp } from './use-cases/create-top-up'
import { HandlePaymentEvent } from './use-cases/handle-payment-event'
import { GetTopUp, GetWallet, ListTransactions } from './use-cases/read-billing'
import { ReconcileTopUps } from './use-cases/reconcile-top-ups'

class InMemoryTopUps implements TopUpRepository {
  rows = new Map<string, TopUp>()
  async insert(topUp: TopUp) {
    const key = topUp.props.idempotencyKey
    if (key && (await this.findByIdempotencyKey(topUp.props.userId as string, key))) return false
    this.rows.set(topUp.id, topUp)
    return true
  }
  async findById(id: string) {
    return this.rows.get(id) ?? null
  }
  async findByIdempotencyKey(userId: string, key: string) {
    return (
      [...this.rows.values()].find(
        (t) => t.props.userId === userId && t.props.idempotencyKey === key,
      ) ?? null
    )
  }
  async claimForReconciliation(q: {
    createdBefore: Date
    createdAfter: Date
    checkedBefore: Date
    limit: number
    now: Date
  }) {
    const due = [...this.rows.values()]
      .filter(
        (t) =>
          ['pending', 'failed'].includes(t.props.status) &&
          t.props.createdAt < q.createdBefore &&
          t.props.createdAt > q.createdAfter &&
          (!t.props.reconciledAt || t.props.reconciledAt < q.checkedBefore),
      )
      .slice(0, q.limit)
    return due.map((t) => {
      const next = TopUp.restore({ ...t.props, reconciledAt: q.now })
      this.rows.set(t.id, next)
      return next
    })
  }
  async findByPaymentIntent(paymentIntentId: string) {
    return [...this.rows.values()].find((t) => t.props.paymentIntentId === paymentIntentId) ?? null
  }
  async settle(
    id: string,
    from: readonly TopUpStatus[],
    to: TopUpStatus,
    now: Date,
    failureReason: string | null = null,
  ) {
    const current = this.rows.get(id)
    if (!current || !from.includes(current.props.status)) return null
    const next = TopUp.restore({ ...current.props, status: to, failureReason, updatedAt: now })
    this.rows.set(id, next)
    return next
  }
  async list(query: { userId: string; before?: string; limit: number }) {
    const { before } = query
    return [...this.rows.values()]
      .filter((t) => t.props.userId === query.userId && (!before || t.id < before))
      .sort((a, b) => (a.id < b.id ? 1 : -1))
      .slice(0, query.limit)
  }
}

class InMemoryLedger implements LedgerRepository {
  entriesList: LedgerEntryRecord[] = []
  amounts = new Map<string, number>()
  async post(entry: LedgerEntryRecord & { userId: string }) {
    // The unique indexes of the real table: one top-up credit per top-up, one entry per refund or dispute.
    const duplicate = this.entriesList.some((e) =>
      entry.type === 'topup'
        ? e.type === 'topup' && e.topUpId === entry.topUpId
        : e.type === entry.type && e.reference === entry.reference,
    )
    if (duplicate) return null
    this.entriesList.push(entry)
    const key = `${entry.userId}:${entry.currency}`
    const next = (this.amounts.get(key) ?? 0) + entry.amount
    this.amounts.set(key, next)
    return next
  }
  async hasReference(type: LedgerEntryType, reference: string) {
    return this.entriesList.some((e) => e.type === type && e.reference === reference)
  }
  async balances(userId: string): Promise<Balance[]> {
    return [...this.amounts.entries()]
      .filter(([key]) => key.startsWith(`${userId}:`))
      .map(([key, amount]) => ({ currency: key.split(':')[1] as string, amount }))
  }
  async entries(userId: string) {
    return this.entriesList.filter((e) => e.userId === userId)
  }
}

class InMemoryAudit implements PaymentAuditRepository {
  events = new Map<string, { result: string; deliveries: number }>()
  anomalies: { kind: AnomalyKind; paymentIntentId: string }[] = []
  async recordEvent(e: { id: string; result: string }) {
    const seen = this.events.get(e.id)
    this.events.set(e.id, { result: e.result, deliveries: (seen?.deliveries ?? 0) + 1 })
  }
  async recordAnomaly(a: { kind: AnomalyKind; paymentIntentId: string }) {
    if (!this.anomalies.some((x) => x.kind === a.kind && x.paymentIntentId === a.paymentIntentId))
      this.anomalies.push({ kind: a.kind, paymentIntentId: a.paymentIntentId })
  }
  kinds() {
    return this.anomalies.map((a) => a.kind)
  }
}

const silentLog = { info() {}, warn() {}, error() {} }
const ALICE = '00000000-0000-7000-8000-00000000a11c'
const BOB = '00000000-0000-7000-8000-0000000000b0'

const policy = new CurrencyPolicy([
  { code: 'usd', min: 500, max: 100_000, presets: [500, 1000] },
  { code: 'vnd', min: 20_000, max: 25_000_000, presets: [50_000] },
])

let topUps: InMemoryTopUps
let ledger: InMemoryLedger
let outbox: InMemoryOutbox
let audit: InMemoryAudit
let gateway: FakePaymentGateway
let ids: SequentialIds
let clock: FakeClock
let createTopUp: CreateTopUp
let handle: HandlePaymentEvent

beforeEach(() => {
  topUps = new InMemoryTopUps()
  ledger = new InMemoryLedger()
  outbox = new InMemoryOutbox()
  audit = new InMemoryAudit()
  gateway = new FakePaymentGateway()
  ids = new SequentialIds()
  clock = new FakeClock()
  createTopUp = new CreateTopUp(policy, gateway, topUps, ids, clock)
  handle = new HandlePaymentEvent(
    topUps,
    ledger,
    audit,
    outbox,
    new PassthroughUnitOfWork(),
    ids,
    clock,
    silentLog,
  )
})

const start = async (userId = ALICE, currency = 'usd', amount = 1000) => {
  const { topUpId } = await createTopUp.execute({ userId, currency, amount })
  const topUp = await topUps.findById(topUpId)
  return { topUpId, paymentIntentId: topUp?.props.paymentIntentId as string }
}

describe('CreateTopUp', () => {
  test('creates a pending top-up and returns the secret to complete the payment', async () => {
    const { clientSecret, topUpId } = await createTopUp.execute({
      userId: ALICE,
      currency: 'USD',
      amount: 2000,
    })
    expect(clientSecret).toContain('secret')
    expect((await topUps.findById(topUpId))?.props).toMatchObject({
      userId: ALICE,
      currency: 'usd',
      amount: 2000,
      status: 'pending',
    })
    expect(ledger.entriesList).toHaveLength(0) // nothing is credited before the provider confirms
  })

  test('rejects a currency that is not offered', async () => {
    await expect(
      createTopUp.execute({ userId: ALICE, currency: 'gbp', amount: 1000 }),
    ).rejects.toMatchObject({ code: 'unsupported_currency' })
  })

  test.each([
    ['below the minimum', 'usd', 499],
    ['above the maximum', 'usd', 100_001],
    ['not a whole number', 'usd', 1000.5],
    ['below the minimum of dong', 'vnd', 1000],
  ])('rejects an amount %s', async (_label, currency, amount) => {
    await expect(createTopUp.execute({ userId: ALICE, currency, amount })).rejects.toMatchObject({
      code: 'amount_out_of_range',
    })
    expect(topUps.rows.size).toBe(0)
  })

  describe('with an Idempotency-Key', () => {
    const key = 'checkout-attempt-0001'

    test('starting the same top-up again returns the first one and opens no second payment', async () => {
      const first = await createTopUp.execute({
        userId: ALICE,
        currency: 'usd',
        amount: 2000,
        idempotencyKey: key,
      })
      const again = await createTopUp.execute({
        userId: ALICE,
        currency: 'usd',
        amount: 2000,
        idempotencyKey: key,
      })

      expect(again).toEqual(first)
      expect(topUps.rows.size).toBe(1)
      expect(gateway.intents.size).toBe(1)
    })

    test('a key used for another amount is refused, not mistaken for a retry', async () => {
      await createTopUp.execute({
        userId: ALICE,
        currency: 'usd',
        amount: 2000,
        idempotencyKey: key,
      })
      await expect(
        createTopUp.execute({ userId: ALICE, currency: 'usd', amount: 3000, idempotencyKey: key }),
      ).rejects.toMatchObject({ code: 'idempotency_key_reused' })
      expect(topUps.rows.size).toBe(1)
    })

    test('the same key from two users is two top-ups', async () => {
      const a = await createTopUp.execute({
        userId: ALICE,
        currency: 'usd',
        amount: 2000,
        idempotencyKey: key,
      })
      const b = await createTopUp.execute({
        userId: BOB,
        currency: 'usd',
        amount: 2000,
        idempotencyKey: key,
      })
      expect(a.topUpId).not.toBe(b.topUpId)
      expect(gateway.intents.size).toBe(2)
    })

    test('two requests racing with one key end up with one top-up', async () => {
      const first = await createTopUp.execute({
        userId: ALICE,
        currency: 'usd',
        amount: 2000,
        idempotencyKey: key,
      })
      // The second request looked before the first stored its row, so it goes on to the provider and to the insert.
      let looked = 0
      const find = topUps.findByIdempotencyKey.bind(topUps)
      topUps.findByIdempotencyKey = async (userId, k) => (looked++ === 0 ? null : find(userId, k))

      const second = await createTopUp.execute({
        userId: ALICE,
        currency: 'usd',
        amount: 2000,
        idempotencyKey: key,
      })

      expect(second).toEqual(first)
      expect(topUps.rows.size).toBe(1)
      expect(gateway.intents.size).toBe(1)
    })
  })

  test('without a key every call is a new top-up', async () => {
    const a = await createTopUp.execute({ userId: ALICE, currency: 'usd', amount: 2000 })
    const b = await createTopUp.execute({ userId: ALICE, currency: 'usd', amount: 2000 })
    expect(a.topUpId).not.toBe(b.topUpId)
  })

  test('refuses when payments are not configured', async () => {
    const off = new CreateTopUp(policy, undefined, topUps, ids, clock)
    await expect(
      off.execute({ userId: ALICE, currency: 'usd', amount: 1000 }),
    ).rejects.toMatchObject({ code: 'billing_disabled' })
  })
})

describe('HandlePaymentEvent', () => {
  test('credits the wallet once and tells the others', async () => {
    const { topUpId, paymentIntentId } = await start(ALICE, 'usd', 1000)
    const event = gateway.eventFor(paymentIntentId, 'succeeded')

    expect(await handle.execute(event)).toBe('applied')
    expect(await new GetWallet(ledger).execute({ userId: ALICE })).toEqual({
      balances: [{ currency: 'usd', amount: 1000 }],
    })
    expect((await topUps.findById(topUpId))?.props.status).toBe('succeeded')
    expect(outbox.types()).toEqual([BillingEvents.TopUpSucceeded])
    expect(outbox.events[0]?.payload).toMatchObject({ topUpId, userId: ALICE, balance: 1000 })
  })

  test('a repeated delivery changes nothing', async () => {
    const { paymentIntentId } = await start()
    const event = gateway.eventFor(paymentIntentId, 'succeeded')
    await handle.execute(event)

    expect(await handle.execute(event)).toBe('ignored')
    expect(ledger.entriesList).toHaveLength(1)
    expect(outbox.events).toHaveLength(1)
  })

  test('balances add up per currency', async () => {
    for (const [currency, amount] of [
      ['usd', 1000],
      ['usd', 2500],
      ['vnd', 50_000],
    ] as const) {
      const { paymentIntentId } = await start(ALICE, currency, amount)
      await handle.execute(gateway.eventFor(paymentIntentId, 'succeeded'))
    }
    const { balances } = await new GetWallet(ledger).execute({ userId: ALICE })
    expect(balances).toContainEqual({ currency: 'usd', amount: 3500 })
    expect(balances).toContainEqual({ currency: 'vnd', amount: 50_000 })
  })

  test('a declined payment records why and credits nothing', async () => {
    const { topUpId, paymentIntentId } = await start()
    await handle.execute(gateway.eventFor(paymentIntentId, 'failed'))

    expect((await topUps.findById(topUpId))?.props).toMatchObject({
      status: 'failed',
      failureReason: 'Your card was declined.',
    })
    expect(ledger.entriesList).toHaveLength(0)
    expect(outbox.types()).toEqual([BillingEvents.TopUpFailed])
  })

  test('a declined payment can still be completed with another method', async () => {
    const { topUpId, paymentIntentId } = await start()
    await handle.execute(gateway.eventFor(paymentIntentId, 'failed'))
    await handle.execute(gateway.eventFor(paymentIntentId, 'succeeded'))

    const topUp = await topUps.findById(topUpId)
    expect(topUp?.props.status).toBe('succeeded')
    expect(topUp?.props.failureReason).toBeNull()
    expect(ledger.entriesList).toHaveLength(1)
  })

  test('a late "failed" after "succeeded" does not take the money back', async () => {
    const { topUpId, paymentIntentId } = await start()
    await handle.execute(gateway.eventFor(paymentIntentId, 'succeeded'))

    expect(await handle.execute(gateway.eventFor(paymentIntentId, 'failed'))).toBe('ignored')
    expect((await topUps.findById(topUpId))?.props.status).toBe('succeeded')
    expect(outbox.types()).toEqual([BillingEvents.TopUpSucceeded])
  })

  test('a canceled payment is final and credits nothing', async () => {
    const { topUpId, paymentIntentId } = await start()
    await handle.execute(gateway.eventFor(paymentIntentId, 'canceled'))
    await handle.execute(gateway.eventFor(paymentIntentId, 'succeeded'))

    expect((await topUps.findById(topUpId))?.props.status).toBe('canceled')
    expect(ledger.entriesList).toHaveLength(0)
  })

  test('never credits an amount different from the one asked for', async () => {
    const { topUpId, paymentIntentId } = await start(ALICE, 'usd', 1000)
    const event = { ...gateway.eventFor(paymentIntentId, 'succeeded'), amount: 99_999 }

    expect(await handle.execute(event)).toBe('ignored')
    expect((await topUps.findById(topUpId))?.props.status).toBe('pending')
    expect(ledger.entriesList).toHaveLength(0)
  })

  test('ignores a payment that is not a top-up of ours', async () => {
    expect(
      await handle.execute({
        kind: 'outcome',
        id: 'evt_x',
        topUpId: null,
        outcome: 'succeeded',
        paymentIntentId: 'pi_unknown',
        amount: 1000,
        currency: 'usd',
        failureReason: null,
      }),
    ).toBe('ignored')
  })
})

describe('HandlePaymentEvent: audit trail', () => {
  test('every event is recorded, and a repeat only counts up', async () => {
    const { paymentIntentId } = await start()
    const event = gateway.eventFor(paymentIntentId, 'succeeded', 'evt_1')
    await handle.execute(event)
    await handle.execute(event)

    expect(audit.events.get('evt_1')).toEqual({ result: 'ignored', deliveries: 2 })
    expect(audit.anomalies).toEqual([])
  })

  test('a wrong amount is an anomaly someone must look at, and credits nothing', async () => {
    const { paymentIntentId } = await start(ALICE, 'usd', 1000)
    await handle.execute({ ...gateway.eventFor(paymentIntentId, 'succeeded'), amount: 99_999 })
    await handle.execute({ ...gateway.eventFor(paymentIntentId, 'succeeded'), amount: 99_999 })

    expect(audit.kinds()).toEqual(['amount_mismatch']) // once, however often it is delivered
    expect(ledger.entriesList).toHaveLength(0)
  })

  test('money that arrives after the account was erased is an anomaly', async () => {
    const { topUpId, paymentIntentId } = await start()
    const topUp = await topUps.findById(topUpId)
    topUps.rows.set(topUpId, TopUp.restore({ ...(topUp as TopUp).props, userId: null }))

    expect(await handle.execute(gateway.eventFor(paymentIntentId, 'succeeded'))).toBe('ignored')
    expect(audit.kinds()).toEqual(['paid_after_erasure'])
    expect(ledger.entriesList).toHaveLength(0)
  })

  test('a payment that names one of our top-ups but has none is an anomaly; a stranger is not', async () => {
    const { paymentIntentId } = await start()
    const ours = gateway.eventFor(paymentIntentId, 'succeeded')
    await handle.execute({ ...ours, id: 'evt_a', paymentIntentId: 'pi_lost', topUpId: 'tu_123' })
    await handle.execute({ ...ours, id: 'evt_b', paymentIntentId: 'pi_stranger', topUpId: null })

    expect(audit.anomalies).toEqual([{ kind: 'unknown_payment', paymentIntentId: 'pi_lost' }])
  })
})

describe('HandlePaymentEvent: refunds and disputes', () => {
  const balanceOf = async () =>
    (await new GetWallet(ledger).execute({ userId: ALICE })).balances.find(
      (b) => b.currency === 'usd',
    )?.amount

  const paid = async (amount = 1000) => {
    const { paymentIntentId, topUpId } = await start(ALICE, 'usd', amount)
    await handle.execute(gateway.eventFor(paymentIntentId, 'succeeded'))
    return { paymentIntentId, topUpId }
  }

  test('a refund takes its amount off the wallet, once however often it is delivered', async () => {
    const { paymentIntentId } = await paid(1000)
    const refund = gateway.adjustmentFor(paymentIntentId, 'refund', 're_1', 400)

    expect(await handle.execute(refund)).toBe('applied')
    expect(await handle.execute(refund)).toBe('ignored')
    expect(await balanceOf()).toBe(600)
    expect(ledger.entriesList.map((e) => [e.type, e.amount, e.reference])).toEqual([
      ['topup', 1000, null],
      ['refund', -400, 're_1'],
    ])
  })

  test('a second, partial refund is its own entry', async () => {
    const { paymentIntentId } = await paid(1000)
    await handle.execute(gateway.adjustmentFor(paymentIntentId, 'refund', 're_1', 400))
    await handle.execute(gateway.adjustmentFor(paymentIntentId, 'refund', 're_2', 100))
    expect(await balanceOf()).toBe(500)
  })

  test('a refund that arrives before the payment is settled waits, then applies', async () => {
    const { paymentIntentId } = await start(ALICE, 'usd', 1000)
    const refund = gateway.adjustmentFor(paymentIntentId, 'refund', 're_1', 400)

    expect(await handle.execute(refund)).toBe('deferred')
    expect(ledger.entriesList).toHaveLength(0)

    await handle.execute(gateway.eventFor(paymentIntentId, 'succeeded'))
    expect(await handle.execute(refund)).toBe('applied') // the provider delivers it again
    expect(await balanceOf()).toBe(600)
  })

  test('a refund of a payment that is not ours is ignored', async () => {
    await paid()
    const stranger = {
      ...gateway.adjustmentFor([...gateway.intents.keys()][0] as string, 'refund', 're_9'),
      paymentIntentId: 'pi_stranger',
    }
    expect(await handle.execute(stranger)).toBe('ignored')
    expect(await balanceOf()).toBe(1000)
  })

  test('a dispute takes the money back, and winning it returns it', async () => {
    const { paymentIntentId } = await paid(1000)
    await handle.execute(gateway.adjustmentFor(paymentIntentId, 'chargeback', 'dp_1'))
    expect(await balanceOf()).toBe(0)

    await handle.execute(gateway.adjustmentFor(paymentIntentId, 'chargeback_reversal', 'dp_1'))
    expect(await balanceOf()).toBe(1000)
  })

  test('a dispute won before its opening was delivered returns nothing until the opening is booked', async () => {
    const { paymentIntentId } = await paid(1000)
    const won = gateway.adjustmentFor(paymentIntentId, 'chargeback_reversal', 'dp_1')

    expect(await handle.execute(won)).toBe('deferred')
    expect(await balanceOf()).toBe(1000)

    await handle.execute(gateway.adjustmentFor(paymentIntentId, 'chargeback', 'dp_1'))
    expect(await handle.execute(won)).toBe('applied') // delivered again
    expect(await balanceOf()).toBe(1000)
    expect(await handle.execute(won)).toBe('ignored')
  })

  test('taking a balance below zero is booked and raised as an anomaly', async () => {
    const { paymentIntentId } = await paid(1000)
    await handle.execute(gateway.adjustmentFor(paymentIntentId, 'refund', 're_1', 1000))
    expect(audit.anomalies).toEqual([])

    await handle.execute(gateway.adjustmentFor(paymentIntentId, 'chargeback', 'dp_1', 300))
    expect(await balanceOf()).toBe(-300)
    expect(audit.kinds()).toEqual(['negative_balance'])
  })

  test('an adjustment in another currency than the top-up is refused', async () => {
    const { paymentIntentId } = await paid(1000)
    const refund = {
      ...gateway.adjustmentFor(paymentIntentId, 'refund', 're_1', 100),
      currency: 'eur',
    }

    expect(await handle.execute(refund)).toBe('ignored')
    expect(audit.kinds()).toEqual(['adjustment_mismatch'])
    expect(await balanceOf()).toBe(1000)
  })

  test('nothing is taken back from a payment that was canceled', async () => {
    const { paymentIntentId } = await start()
    await handle.execute(gateway.eventFor(paymentIntentId, 'canceled'))
    expect(
      await handle.execute(gateway.adjustmentFor(paymentIntentId, 'refund', 're_1', 100)),
    ).toBe('ignored')
    expect(ledger.entriesList).toHaveLength(0)
  })
})

describe('ReconcileTopUps', () => {
  const GRACE = 15 * 60_000
  let reconcile: ReconcileTopUps

  beforeEach(() => {
    reconcile = new ReconcileTopUps(
      topUps,
      gateway,
      handle,
      { settleGraceMs: GRACE, giveUpAfterMs: 3 * 24 * 3600_000, batchSize: 50 },
      clock,
      silentLog,
    )
  })

  test('credits a payment whose webhook never came', async () => {
    const { topUpId, paymentIntentId } = await start(ALICE, 'usd', 1000)
    gateway.ended.set(paymentIntentId, 'succeeded')
    clock.advance(GRACE + 1000)

    expect(await reconcile.runOnce()).toBe(1)
    expect((await topUps.findById(topUpId))?.props.status).toBe('succeeded')
    expect(await new GetWallet(ledger).execute({ userId: ALICE })).toEqual({
      balances: [{ currency: 'usd', amount: 1000 }],
    })
    expect(outbox.types()).toEqual([BillingEvents.TopUpSucceeded])
  })

  test('leaves a payment alone while its webhook may still be on the way', async () => {
    const { paymentIntentId } = await start()
    gateway.ended.set(paymentIntentId, 'succeeded')
    clock.advance(GRACE - 1000)

    expect(await reconcile.runOnce()).toBe(0)
    expect(ledger.entriesList).toHaveLength(0)
  })

  test('a payment still open at the provider stays pending, and is not asked about again at once', async () => {
    const { topUpId, paymentIntentId } = await start()
    clock.advance(GRACE + 1000)
    let asked = 0
    const retrieve = gateway.retrievePayment.bind(gateway)
    gateway.retrievePayment = async (id) => (asked++, retrieve(id))

    await reconcile.runOnce()
    await reconcile.runOnce()
    expect(asked).toBe(1)
    expect((await topUps.findById(topUpId))?.props.status).toBe('pending')

    clock.advance(GRACE + 1000)
    gateway.ended.set(paymentIntentId, 'failed')
    await reconcile.runOnce()
    expect(asked).toBe(2)
    expect((await topUps.findById(topUpId))?.props.status).toBe('failed')
  })

  test('the webhook arriving after the reconciliation credits nothing twice', async () => {
    const { paymentIntentId } = await start(ALICE, 'usd', 1000)
    gateway.ended.set(paymentIntentId, 'succeeded')
    clock.advance(GRACE + 1000)
    await reconcile.runOnce()

    expect(await handle.execute(gateway.eventFor(paymentIntentId, 'succeeded'))).toBe('ignored')
    expect(ledger.entriesList).toHaveLength(1)
  })

  test('gives up on payments older than the window', async () => {
    const { paymentIntentId } = await start()
    gateway.ended.set(paymentIntentId, 'succeeded')
    clock.advance(4 * 24 * 3600_000)

    expect(await reconcile.runOnce()).toBe(0)
  })

  test('one failing lookup does not stop the others', async () => {
    const a = await start(ALICE, 'usd', 1000)
    const b = await start(BOB, 'usd', 1500)
    gateway.ended.set(b.paymentIntentId, 'succeeded')
    clock.advance(GRACE + 1000)
    const retrieve = gateway.retrievePayment.bind(gateway)
    gateway.retrievePayment = async (id) => {
      if (id === a.paymentIntentId) throw new Error('provider unavailable')
      return retrieve(id)
    }

    expect(await reconcile.runOnce()).toBe(1)
    expect((await topUps.findById(b.topUpId))?.props.status).toBe('succeeded')
  })
})

describe('reading', () => {
  test('a top-up is visible to its owner only', async () => {
    const { topUpId } = await start(ALICE)
    const get = new GetTopUp(topUps)

    expect((await get.execute({ userId: ALICE, topUpId })).status).toBe('pending')
    await expect(get.execute({ userId: BOB, topUpId })).rejects.toMatchObject({
      code: 'topup_not_found',
    })
  })

  test('the history is paged newest first with a cursor', async () => {
    for (let i = 0; i < 5; i++) await start(ALICE)
    await start(BOB)
    const list = new ListTransactions(topUps)

    const first = await list.execute({ userId: ALICE, limit: 2 })
    expect(first.items).toHaveLength(2)
    expect(first.nextCursor).toBe(first.items[1]?.id as string)

    const second = await list.execute({ userId: ALICE, limit: 2, before: first.nextCursor ?? '' })
    const last = await list.execute({ userId: ALICE, limit: 2, before: second.nextCursor ?? '' })
    expect(last.items).toHaveLength(1)
    expect(last.nextCursor).toBeNull()

    const all = [...first.items, ...second.items, ...last.items].map((i) => i.id)
    expect(new Set(all).size).toBe(5)
    expect(all).toEqual([...all].sort().reverse())
  })
})

describe('BillingDataExporter', () => {
  test('exports the top-ups, the ledger and the balances of that user only', async () => {
    const mine = await start(ALICE, 'usd', 1000)
    await handle.execute(gateway.eventFor(mine.paymentIntentId, 'succeeded'))
    await start(ALICE, 'usd', 2000) // still pending
    const theirs = await start(BOB, 'usd', 5000)
    await handle.execute(gateway.eventFor(theirs.paymentIntentId, 'succeeded'))

    const { data } = await new BillingDataExporter(topUps, ledger).collect(ALICE)
    const exported = data as {
      balances: Balance[]
      topUps: { status: string; amount: number }[]
      ledger: { amount: number }[]
    }
    expect(exported.balances).toEqual([{ currency: 'usd', amount: 1000 }])
    expect(exported.topUps.map((t) => t.status).sort()).toEqual(['pending', 'succeeded'])
    expect(exported.ledger).toEqual([expect.objectContaining({ amount: 1000 })])
  })
})
