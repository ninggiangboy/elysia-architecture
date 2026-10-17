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
  // So a lost webhook can be reconciled within a test.
  BILLING_SETTLE_GRACE: '1s',
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

const startTopUp = async (
  token: string,
  currency = 'usd',
  amount = 2000,
  idempotencyKey?: string,
) => {
  const res = await api('POST', '/api/billing/topups', {
    token,
    body: { currency, amount },
    headers: idempotencyKey ? { 'idempotency-key': idempotencyKey } : undefined,
  })
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

describe('starting a top-up twice', () => {
  test('with the same Idempotency-Key is one top-up and one payment', async () => {
    const token = (await login(api, uniqueEmail('idem'))).accessToken
    const key = `attempt-${crypto.randomUUID()}`
    const post = (amount: number) =>
      api('POST', '/api/billing/topups', {
        token,
        body: { currency: 'usd', amount },
        headers: { 'idempotency-key': key },
      })

    // A double click: both requests are in flight together.
    const [a, b] = await Promise.all([post(2000), post(2000)])
    expect([a.status, b.status]).toEqual([200, 200])
    expect(b.json).toEqual(a.json)
    expect((await post(2000)).json).toEqual(a.json) // and a retry later

    const history = await api('GET', '/api/billing/transactions', { token })
    expect(history.json.items).toHaveLength(1)
    expect(
      [...gateway.intents.values()].filter((i) => i.idempotencyKey.endsWith(key)),
    ).toHaveLength(1)

    const other = await post(3000)
    expect(other.status).toBe(409)
    expect(other.json.error.code).toBe('idempotency_key_reused')
  })

  test('without a key is two top-ups, and a malformed key is refused', async () => {
    const token = (await login(api, uniqueEmail('nokey'))).accessToken
    await startTopUp(token)
    await startTopUp(token)
    expect((await api('GET', '/api/billing/transactions', { token })).json.items).toHaveLength(2)

    const res = await api('POST', '/api/billing/topups', {
      token,
      body: { currency: 'usd', amount: 2000 },
      headers: { 'idempotency-key': 'short' },
    })
    expect(res.status).toBe(400)
  })
})

describe('webhook delivery', () => {
  test('the same event delivered at the same moment credits once', async () => {
    const token = (await login(api, uniqueEmail('race'))).accessToken
    const { topUpId, paymentIntentId } = await startTopUp(token, 'usd', 2000)
    const eventId = `evt_race_${crypto.randomUUID()}`
    const event = gateway.eventFor(paymentIntentId, 'succeeded', eventId)

    const results = await Promise.all(Array.from({ length: 8 }, () => webhook(event)))

    expect(results.map((r) => r.status)).toEqual(Array(8).fill(200))
    expect((await api('GET', '/api/billing/wallet', { token })).json.balances).toEqual([
      { currency: 'usd', amount: 2000 },
    ])
    const rows = await t.container.database.db.execute<{ entries: number; deliveries: number }>(
      sql`select (select count(*)::int from billing.ledger_entries where top_up_id = ${topUpId}) as entries,
                 (select deliveries from billing.payment_events where id = ${eventId}) as deliveries`,
    )
    expect(rows[0]).toEqual({ entries: 1, deliveries: 8 })
  })

  test('"succeeded" and "failed" racing leave a credited top-up, never a lost one', async () => {
    const token = (await login(api, uniqueEmail('race2'))).accessToken
    const { topUpId, paymentIntentId } = await startTopUp(token, 'usd', 1500)

    await Promise.all([
      webhook(gateway.eventFor(paymentIntentId, 'failed')),
      webhook(gateway.eventFor(paymentIntentId, 'succeeded')),
      webhook(gateway.eventFor(paymentIntentId, 'failed')),
    ])

    expect((await api('GET', `/api/billing/topups/${topUpId}`, { token })).json.status).toBe(
      'succeeded',
    )
    expect((await api('GET', '/api/billing/wallet', { token })).json.balances).toEqual([
      { currency: 'usd', amount: 1500 },
    ])
  })

  test('a wrong amount credits nothing and leaves an anomaly for people', async () => {
    const token = (await login(api, uniqueEmail('mismatch'))).accessToken
    const { topUpId, paymentIntentId } = await startTopUp(token, 'usd', 2000)

    const event = { ...gateway.eventFor(paymentIntentId, 'succeeded'), amount: 5 }
    expect((await webhook(event)).status).toBe(200)
    expect((await webhook(event)).status).toBe(200)

    expect((await api('GET', '/api/billing/wallet', { token })).json.balances).toEqual([])
    const rows = await t.container.database.db.execute<{ kind: string; n: number }>(
      sql`select kind, count(*)::int as n from billing.payment_anomalies
          where top_up_id = ${topUpId} group by kind`,
    )
    expect([...rows]).toEqual([{ kind: 'amount_mismatch', n: 1 }])
  })

  test('a refund and a won dispute move the wallet, each once', async () => {
    const token = (await login(api, uniqueEmail('refund'))).accessToken
    const { paymentIntentId } = await startTopUp(token, 'usd', 5000)
    const balance = async () =>
      (await api('GET', '/api/billing/wallet', { token })).json.balances[0]?.amount

    // A refund that overtakes the payment's own event is not lost: Stripe is told to come back.
    const refund = gateway.adjustmentFor(
      paymentIntentId,
      'refund',
      `re_${crypto.randomUUID()}`,
      1200,
    )
    const early = await webhook(refund)
    expect(early.status).toBe(409)
    expect(early.json.error?.code).toBe('payment_not_settled_yet')

    await webhook(gateway.eventFor(paymentIntentId, 'succeeded'))
    expect((await webhook(refund)).status).toBe(200)
    expect((await webhook(refund)).status).toBe(200)
    expect(await balance()).toBe(3800)

    const dispute = `dp_${crypto.randomUUID()}`
    await webhook(gateway.adjustmentFor(paymentIntentId, 'chargeback', dispute, 3800))
    expect(await balance()).toBe(0)
    await webhook(gateway.adjustmentFor(paymentIntentId, 'chargeback_reversal', dispute, 3800))
    expect(await balance()).toBe(3800)
  })
})

describe('invoices and receipts', () => {
  const documents = async (token: string, query = '') =>
    (await api('GET', `/api/billing/documents${query}`, { token })).json.items as {
      id: string
      kind: string
      number: string
      status: string
      topUpId: string
      invoiceId: string | null
      amount: number
      buyer: { name: string | null; email: string | null; taxId: string | null }
      seller: { name: string }
    }[]

  test('an invoice is issued with the top-up, the receipt when it is paid', async () => {
    const email = uniqueEmail('invoice')
    const token = (await login(api, email)).accessToken
    const res = await api('POST', '/api/billing/topups', {
      token,
      body: {
        currency: 'usd',
        amount: 2500,
        billing: { name: 'Acme Corp', taxId: 'VN0312345678', address: '1 Main St' },
      },
    })
    expect(res.status).toBe(200)
    const topUpId = res.json.topUpId as string
    const intent = [...gateway.intents.values()].find((i) => i.topUpId === topUpId)

    const [invoice, ...others] = await documents(token)
    expect(others).toEqual([])
    expect(invoice).toMatchObject({
      kind: 'invoice',
      status: 'open',
      topUpId,
      amount: 2500,
      buyer: { name: 'Acme Corp', email, taxId: 'VN0312345678' },
    })
    expect(invoice?.number).toMatch(/^INV-\d{4}-\d{6}$/)

    // Paid — delivered at the same moment several times: still one receipt.
    const event = gateway.eventFor(intent?.id as string, 'succeeded')
    await Promise.all(Array.from({ length: 5 }, () => webhook(event)))

    const receipts = await documents(token, '?kind=receipt')
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({ invoiceId: invoice?.id, amount: 2500, status: 'issued' })
    expect(receipts[0]?.number).toMatch(/^RCT-\d{4}-\d{6}$/)
    expect((await documents(token, '?kind=invoice'))[0]?.status).toBe('paid')
    expect(await documents(token, `?topUpId=${topUpId}`)).toHaveLength(2)

    const one = await api('GET', `/api/billing/documents/${receipts[0]?.id}`, { token })
    expect(one.status).toBe(200)
    expect(one.json).toMatchObject({
      number: receipts[0]?.number,
      seller: { name: expect.any(String) },
    })
  })

  test('a refund is a credit note, a canceled payment a void invoice', async () => {
    const token = (await login(api, uniqueEmail('credit'))).accessToken
    const paid = await startTopUp(token, 'usd', 4000)
    await webhook(gateway.eventFor(paid.paymentIntentId, 'succeeded'))
    const reference = `re_${crypto.randomUUID()}`
    const refund = gateway.adjustmentFor(paid.paymentIntentId, 'refund', reference, 1000)
    await webhook(refund)
    await webhook(refund)
    const notes = await documents(token, '?kind=credit_note')
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ amount: 1000, status: 'issued', topUpId: paid.topUpId })

    const abandoned = await startTopUp(token, 'usd', 700)
    await webhook(gateway.eventFor(abandoned.paymentIntentId, 'canceled'))
    const voided = (await documents(token, `?topUpId=${abandoned.topUpId}`))[0]
    expect(voided).toMatchObject({ kind: 'invoice', status: 'void' })
  })

  test("someone else's document does not exist, and reading needs a session", async () => {
    const alice = (await login(api, uniqueEmail('doc-a'))).accessToken
    const bob = (await login(api, uniqueEmail('doc-b'))).accessToken
    await startTopUp(alice)
    const [mine] = await documents(alice)
    expect((await api('GET', `/api/billing/documents/${mine?.id}`, { token: bob })).status).toBe(
      404,
    )
    expect(await documents(bob)).toEqual([])
    expect((await api('GET', '/api/billing/documents')).status).toBe(401)
  })
})

describe('a lost webhook', () => {
  test('is made up for by asking Stripe, once, whichever comes first', async () => {
    const token = (await login(api, uniqueEmail('lost'))).accessToken
    const { topUpId, paymentIntentId } = await startTopUp(token, 'usd', 2500)
    gateway.ended.set(paymentIntentId, 'succeeded') // paid at Stripe; our webhook never came

    await Bun.sleep(1100) // past the grace period
    // Top-ups left open by other tests are in the same queue (oldest first, a batch at a time): go on until ours is done.
    await eventually(async () => {
      await t.container.modules.billing.reconcile()
      const res = await api('GET', `/api/billing/topups/${topUpId}`, { token })
      return res.json.status === 'succeeded'
    })
    expect((await api('GET', '/api/billing/wallet', { token })).json.balances).toEqual([
      { currency: 'usd', amount: 2500 },
    ])

    // Stripe's webhook then turns up after all.
    expect((await webhook(gateway.eventFor(paymentIntentId, 'succeeded'))).status).toBe(200)
    expect((await api('GET', '/api/billing/wallet', { token })).json.balances).toEqual([
      { currency: 'usd', amount: 2500 },
    ])
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
    // The invoice and the receipt stay, but nobody is named on them any more.
    const docs = await db.execute<{ kind: string; user_id: string | null; buyer: unknown }>(
      sql`select kind, user_id, buyer from billing.documents where top_up_id = ${topUpId} order by kind`,
    )
    expect([...docs].map((d) => d.kind)).toEqual(['invoice', 'receipt'])
    for (const d of docs) {
      expect(d.user_id).toBeNull()
      expect(d.buyer).toEqual({ name: null, email: null, address: null, taxId: null })
    }
  })
})
