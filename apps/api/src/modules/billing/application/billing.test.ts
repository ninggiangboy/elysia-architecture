import { beforeEach, describe, expect, test } from 'bun:test'
import {
  FakeClock,
  InMemoryOutbox,
  PassthroughUnitOfWork,
  SequentialIds,
} from '#/shared/testing/fakes'
import { BillingEvents } from '../contracts/events'
import type {
  Balance,
  LedgerEntryRecord,
  LedgerRepository,
  TopUpRepository,
} from '../domain/billing-repository'
import { TopUp, type TopUpStatus } from '../domain/top-up'
import { FakePaymentGateway } from '../infrastructure/fake-payment-gateway'
import { BillingDataExporter } from './billing-data-exporter'
import { CurrencyPolicy } from './currency-policy'
import { CreateTopUp } from './use-cases/create-top-up'
import { HandlePaymentEvent } from './use-cases/handle-payment-event'
import { GetTopUp, GetWallet, ListTransactions } from './use-cases/read-billing'

class InMemoryTopUps implements TopUpRepository {
  rows = new Map<string, TopUp>()
  async insert(topUp: TopUp) {
    this.rows.set(topUp.id, topUp)
  }
  async findById(id: string) {
    return this.rows.get(id) ?? null
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
  async credit(entry: LedgerEntryRecord & { userId: string }) {
    this.entriesList.push(entry)
    const key = `${entry.userId}:${entry.currency}`
    const next = (this.amounts.get(key) ?? 0) + entry.amount
    this.amounts.set(key, next)
    return next
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
let gateway: FakePaymentGateway
let ids: SequentialIds
let clock: FakeClock
let createTopUp: CreateTopUp
let handle: HandlePaymentEvent

beforeEach(() => {
  topUps = new InMemoryTopUps()
  ledger = new InMemoryLedger()
  outbox = new InMemoryOutbox()
  gateway = new FakePaymentGateway()
  ids = new SequentialIds()
  clock = new FakeClock()
  createTopUp = new CreateTopUp(policy, gateway, topUps, ids, clock)
  handle = new HandlePaymentEvent(
    topUps,
    ledger,
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
        id: 'evt_x',
        outcome: 'succeeded',
        paymentIntentId: 'pi_unknown',
        amount: 1000,
        currency: 'usd',
        failureReason: null,
      }),
    ).toBe('ignored')
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
