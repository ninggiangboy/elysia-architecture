import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import {
  FAKE_WEBHOOK_SIGNATURE,
  FakePaymentGateway,
} from '#/modules/billing/infrastructure/fake-payment-gateway'
import { DrizzleBillingDataEraser } from '#/modules/billing/infrastructure/persistence/drizzle-data-eraser'
import {
  client,
  createTestApp,
  eventually,
  login,
  openSse,
  type TestApp,
  uniqueEmail,
} from './helpers'

const STRIPE_ENV = {
  STRIPE_SECRET_KEY: 'sk_test_fake',
  STRIPE_PUBLISHABLE_KEY: 'pk_test_fake',
  STRIPE_WEBHOOK_SECRET: 'whsec_fake',
}

let t: TestApp
let api: ReturnType<typeof client>
const gateway = new FakePaymentGateway()

beforeAll(async () => {
  t = await createTestApp({ paymentGateway: gateway }, STRIPE_ENV)
  api = client(t.app)
})

afterAll(async () => {
  await t.container.close()
})

/** What Stripe does: POST the event, signed, to the webhook. */
const webhook = async (event: unknown, signature: string | null = FAKE_WEBHOOK_SIGNATURE) => {
  const res = await t.app.handle(
    new Request('http://localhost/api/billing/webhooks/stripe', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(signature ? { 'stripe-signature': signature } : {}),
      },
      body: JSON.stringify(event),
    }),
  )
  return { status: res.status, json: (await res.json()) as { error?: { code: string } } }
}

const startTopUp = async (token: string, currency = 'usd', amount = 2000) => {
  const res = await api('POST', '/api/billing/topups', { token, body: { currency, amount } })
  if (res.status !== 200) throw new Error(`top-up refused: ${JSON.stringify(res.json)}`)
  const topUp = await api('GET', `/api/billing/topups/${res.json.topUpId}`, { token })
  const intent = [...gateway.intents.values()].find((i) => i.topUpId === res.json.topUpId)
  if (!intent) throw new Error('the gateway was not asked for a payment')
  return { topUpId: res.json.topUpId as string, paymentIntentId: intent.id, topUp }
}

describe('top-up', () => {
  test('is credited only when the provider confirms, once, and shows up live', async () => {
    const me = await login(api, uniqueEmail('topup'))
    const token = me.accessToken

    const config = await api('GET', '/api/billing/config', { token })
    expect(config.json).toMatchObject({ enabled: true, publishableKey: 'pk_test_fake' })
    expect(config.json.currencies.map((c: { code: string }) => c.code).sort()).toEqual([
      'eur',
      'usd',
      'vnd',
    ])

    const sse = await openSse(t.app, token)
    await sse.next('ready')

    const { topUpId, paymentIntentId, topUp } = await startTopUp(token, 'usd', 2000)
    expect(topUp.json).toMatchObject({ status: 'pending', currency: 'usd', amount: 2000 })
    expect((await api('GET', '/api/billing/wallet', { token })).json.balances).toEqual([])

    const event = gateway.eventFor(paymentIntentId, 'succeeded')
    expect((await webhook(event)).status).toBe(200)
    // Stripe delivers at least once: the repeat must not pay twice.
    expect((await webhook(event)).status).toBe(200)

    expect((await api('GET', '/api/billing/wallet', { token })).json.balances).toEqual([
      { currency: 'usd', amount: 2000 },
    ])
    const settled = await api('GET', `/api/billing/topups/${topUpId}`, { token })
    expect(settled.json.status).toBe('succeeded')

    const history = await api('GET', '/api/billing/transactions', { token })
    expect(history.json.items).toEqual([
      expect.objectContaining({ id: topUpId, status: 'succeeded' }),
    ])
    expect(history.json.nextCursor).toBeNull()

    const pushed = await sse.next('billing.topup', (m) => m.data.topUpId === topUpId)
    expect(pushed.data).toMatchObject({ topUpId, status: 'succeeded', balance: 2000 })
    // The user is told in their notifications, in their own language.
    const inbox = await eventually(async () => {
      const list = await api('GET', '/api/notifications', { token })
      return list.json.items.find((n: { template: string }) => n.template === 'topUpSucceeded')
    })
    expect(inbox).toMatchObject({
      kind: 'payment',
      data: { amount: 2000, currency: 'usd', link: '/settings/wallet' },
    })
    sse.close()
  })

  test('keeps a balance per currency and pages the history', async () => {
    const me = await login(api, uniqueEmail('multi'))
    const token = me.accessToken
    for (const [currency, amount] of [
      ['usd', 1000],
      ['vnd', 100_000],
      ['usd', 500],
    ] as const) {
      const { paymentIntentId } = await startTopUp(token, currency, amount)
      await webhook(gateway.eventFor(paymentIntentId, 'succeeded'))
    }
    const wallet = await api('GET', '/api/billing/wallet', { token })
    expect(wallet.json.balances).toEqual([
      { currency: 'usd', amount: 1500 },
      { currency: 'vnd', amount: 100_000 },
    ])

    const first = await api('GET', '/api/billing/transactions?limit=2', { token })
    expect(first.json.items).toHaveLength(2)
    const second = await api(
      'GET',
      `/api/billing/transactions?limit=2&before=${first.json.nextCursor}`,
      { token },
    )
    expect(second.json.items).toHaveLength(1)
    expect(second.json.nextCursor).toBeNull()
  })

  test('a declined card is recorded and the same top-up can still succeed', async () => {
    const me = await login(api, uniqueEmail('declined'))
    const token = me.accessToken
    const { topUpId, paymentIntentId } = await startTopUp(token, 'eur', 1000)

    await webhook(gateway.eventFor(paymentIntentId, 'failed'))
    expect((await api('GET', `/api/billing/topups/${topUpId}`, { token })).json).toMatchObject({
      status: 'failed',
      failureReason: 'Your card was declined.',
    })
    expect((await api('GET', '/api/billing/wallet', { token })).json.balances).toEqual([])

    await webhook(gateway.eventFor(paymentIntentId, 'succeeded'))
    expect((await api('GET', `/api/billing/topups/${topUpId}`, { token })).json.status).toBe(
      'succeeded',
    )
    expect((await api('GET', '/api/billing/wallet', { token })).json.balances).toEqual([
      { currency: 'eur', amount: 1000 },
    ])
  })

  test('refuses what is not offered', async () => {
    const token = (await login(api, uniqueEmail('bad'))).accessToken
    const post = (body: unknown) => api('POST', '/api/billing/topups', { token, body })

    expect((await post({ currency: 'gbp', amount: 1000 })).json.error.code).toBe(
      'unsupported_currency',
    )
    expect((await post({ currency: 'usd', amount: 100 })).json.error.code).toBe(
      'amount_out_of_range',
    )
    expect((await post({ currency: 'usd', amount: 10.5 })).status).toBe(400)
    expect(
      (await api('POST', '/api/billing/topups', { body: { currency: 'usd', amount: 1000 } }))
        .status,
    ).toBe(401)
  })

  test("someone else's top-up does not exist", async () => {
    const alice = (await login(api, uniqueEmail('alice'))).accessToken
    const bob = (await login(api, uniqueEmail('bob'))).accessToken
    const { topUpId } = await startTopUp(alice)

    const res = await api('GET', `/api/billing/topups/${topUpId}`, { token: bob })
    expect(res.status).toBe(404)
    expect(res.json.error.code).toBe('topup_not_found')
  })
})

describe('webhook', () => {
  test('rejects a body that was not signed by the provider', async () => {
    const token = (await login(api, uniqueEmail('forged'))).accessToken
    const { topUpId, paymentIntentId } = await startTopUp(token)
    const event = gateway.eventFor(paymentIntentId, 'succeeded')

    for (const signature of ['forged', null]) {
      const res = await webhook(event, signature)
      expect(res.status).toBe(400)
      expect(res.json.error?.code).toBe('invalid_signature')
    }
    expect((await api('GET', `/api/billing/topups/${topUpId}`, { token })).json.status).toBe(
      'pending',
    )
    expect((await api('GET', '/api/billing/wallet', { token })).json.balances).toEqual([])
  })

  test('acknowledges events it does not act on', async () => {
    expect((await webhook({ ignore: true })).status).toBe(200)
  })
})

describe('without Stripe configured', () => {
  test('the wallet and history still read, but nobody can top up', async () => {
    const off = await createTestApp(
      {},
      { STRIPE_SECRET_KEY: '', STRIPE_PUBLISHABLE_KEY: '', STRIPE_WEBHOOK_SECRET: '' },
    )
    try {
      const offApi = client(off.app)
      const token = (await login(offApi, uniqueEmail('off'))).accessToken

      expect((await offApi('GET', '/api/billing/config', { token })).json).toMatchObject({
        enabled: false,
        publishableKey: null,
      })
      expect((await offApi('GET', '/api/billing/wallet', { token })).json.balances).toEqual([])
      const res = await offApi('POST', '/api/billing/topups', {
        token,
        body: { currency: 'usd', amount: 1000 },
      })
      expect(res.status).toBe(404)
      expect(res.json.error.code).toBe('billing_disabled')
    } finally {
      await off.container.close()
    }
  })
})

describe('privacy', () => {
  test('erasing keeps the money records without the person, and is safe to repeat', async () => {
    const me = await login(api, uniqueEmail('erase'))
    const { paymentIntentId, topUpId } = await startTopUp(me.accessToken, 'usd', 3000)
    await webhook(gateway.eventFor(paymentIntentId, 'succeeded'))

    const eraser = new DrizzleBillingDataEraser(t.container.database)
    await eraser.erase(me.userId)
    await eraser.erase(me.userId) // idempotent: the job may be nudged

    const db = t.container.database.db
    const one = async (query: ReturnType<typeof sql>) =>
      (await db.execute<{ n: number }>(query))[0]?.n
    expect(
      await one(
        sql`select count(*)::int as n from billing.top_ups where id = ${topUpId} and user_id is null`,
      ),
    ).toBe(1)
    expect(
      await one(
        sql`select count(*)::int as n from billing.ledger_entries where top_up_id = ${topUpId} and user_id is null`,
      ),
    ).toBe(1)
    expect(
      await one(
        sql`select count(*)::int as n from billing.wallet_balances where user_id = ${me.userId}`,
      ),
    ).toBe(0)
  })
})
