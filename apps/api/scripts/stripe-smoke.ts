// Pays a top-up against the real Stripe TEST mode, to prove the whole path: API → Stripe → webhook (Stripe CLI) → wallet.
// Needs: the API running with the STRIPE_* test keys, `bun run dev` (or `bun run stripe:listen`) forwarding webhooks,
// and `bun run infra:up` (the sign-in mail is read from Mailpit). Run it with `bun run test:stripe`.
import Stripe from 'stripe'

const secretKey = process.env.STRIPE_SECRET_KEY
if (!secretKey?.startsWith('sk_test_'))
  throw new Error('STRIPE_SECRET_KEY must be a test key (sk_test_…): this pays with test cards')

const API = process.env.SMOKE_API ?? `http://localhost:${process.env.PORT ?? 3000}`
const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025'
const stripe = new Stripe(secretKey, { httpClient: Stripe.createFetchHttpClient() })

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function call<T = Record<string, unknown>>(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<{ status: number; json: T }> {
  const res = await fetch(`${API}/api${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  return { status: res.status, json: (text ? JSON.parse(text) : undefined) as T }
}

async function signIn(): Promise<string> {
  const email = `smoke-${Date.now()}@example.test`
  const requested = await call('POST', '/auth/magic-link', undefined, { email })
  if (requested.status !== 202) throw new Error(`magic link refused: ${requested.status}`)
  for (let i = 0; i < 40; i++) {
    const found = (await (
      await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)
    ).json()) as { messages?: { ID: string }[] }
    const id = found.messages?.[0]?.ID
    if (id) {
      const mail = (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as {
        Text: string
      }
      const token = mail.Text.match(/token=([^\s&]+)/)?.[1]
      const verified = await call<{ accessToken: string }>(
        'POST',
        '/auth/magic-link/verify',
        undefined,
        {
          token: decodeURIComponent(token ?? ''),
        },
      )
      if (verified.status !== 200) throw new Error(`sign-in failed: ${verified.status}`)
      return verified.json.accessToken
    }
    await sleep(250)
  }
  throw new Error('the sign-in mail never arrived (is Mailpit up? `bun run infra:up`)')
}

type TopUp = { status: string; failureReason: string | null }

async function settled(token: string, topUpId: string, want: string): Promise<TopUp> {
  for (let i = 0; i < 60; i++) {
    const { json } = await call<TopUp>('GET', `/billing/topups/${topUpId}`, token)
    if (json.status === want) return json
    await sleep(500)
  }
  throw new Error(
    `top-up never became ${want}: is the Stripe CLI forwarding webhooks (bun run dev / bun run stripe:listen) ` +
      'and does STRIPE_WEBHOOK_SECRET match `bun run stripe:secret`?',
  )
}

const token = await signIn()
const config = await call<{ enabled: boolean }>('GET', '/billing/config', token)
if (!config.json.enabled)
  throw new Error('the API runs without Stripe: set the STRIPE_* variables and restart it')

async function pay(paymentMethod: string, amount: number) {
  const started = await call<{ topUpId: string; clientSecret: string }>(
    'POST',
    '/billing/topups',
    token,
    {
      currency: 'usd',
      amount,
    },
  )
  if (started.status !== 200) throw new Error(`top-up refused: ${JSON.stringify(started.json)}`)
  const paymentIntentId = started.json.clientSecret.split('_secret_')[0] as string
  const outcome = await stripe.paymentIntents
    .confirm(paymentIntentId, { payment_method: paymentMethod, return_url: 'https://example.com' })
    .then(() => 'confirmed' as const)
    .catch((err: unknown) =>
      err instanceof Stripe.errors.StripeCardError ? ('declined' as const) : Promise.reject(err),
    )
  return { topUpId: started.json.topUpId, outcome }
}

const paid = await pay('pm_card_visa', 1500)
await settled(token, paid.topUpId, 'succeeded')
const wallet = await call<{ balances: { currency: string; amount: number }[] }>(
  'GET',
  '/billing/wallet',
  token,
)
if (wallet.json.balances.find((b) => b.currency === 'usd')?.amount !== 1500)
  throw new Error(`wallet is wrong: ${JSON.stringify(wallet.json)}`)
console.log('✔ 4242 card: top-up succeeded and the wallet holds $15.00')

const declined = await pay('pm_card_chargeDeclined', 1000)
const failed = await settled(token, declined.topUpId, 'failed')
const after = await call<{ balances: { currency: string; amount: number }[] }>(
  'GET',
  '/billing/wallet',
  token,
)
if (after.json.balances.find((b) => b.currency === 'usd')?.amount !== 1500)
  throw new Error('a declined card changed the balance')
console.log(`✔ declined card: top-up failed (${failed.failureReason}) and the balance is unchanged`)
