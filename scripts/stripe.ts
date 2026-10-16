// Stripe CLI for local development: forwards Stripe's webhooks to the API.
//   bun scripts/stripe.ts listen   forward events to the API (also started by `bun run dev` when a key is set)
//   bun scripts/stripe.ts secret   print the webhook signing secret the CLI uses (the value of STRIPE_WEBHOOK_SECRET)
// Uses the `stripe` binary when it is installed, the stripe/stripe-cli image (docker compose profile `stripe`) otherwise.

const EVENTS = 'payment_intent.succeeded,payment_intent.payment_failed,payment_intent.canceled'

const key = process.env.STRIPE_SECRET_KEY
const port = process.env.PORT ?? '3000'

const local = Bun.which('stripe')
const forwardTo = (host: string) => `http://${host}:${port}/api/billing/webhooks/stripe`

/** The command for `stripe <args>`: the local binary, or the compose service (which runs inside docker, hence the host). */
const stripe = (...args: string[]) =>
  local
    ? [local, ...args]
    : [
        'docker',
        'compose',
        '--profile',
        'stripe',
        'run',
        '--rm',
        '--no-deps',
        'stripe-cli',
        ...args,
      ]

const run = (cmd: string[], stdout: 'pipe' | 'inherit') =>
  Bun.spawn(cmd, { stdin: 'inherit', stdout, stderr: 'inherit' })

async function printSecret(): Promise<string | null> {
  const proc = run(stripe('listen', '--print-secret', '--api-key', key as string), 'pipe')
  const out = await new Response(proc.stdout).text()
  await proc.exited
  return out.match(/whsec_\w+/)?.[0] ?? null
}

export async function listen(): Promise<number> {
  if (!key) {
    console.log('[stripe] STRIPE_SECRET_KEY is not set: not forwarding webhooks (top-ups are off)')
    return 0
  }
  const secret = await printSecret()
  if (secret && secret !== process.env.STRIPE_WEBHOOK_SECRET)
    console.warn(
      `[stripe] STRIPE_WEBHOOK_SECRET in .env is not the one the CLI signs with.\n` +
        `         Set STRIPE_WEBHOOK_SECRET=${secret} and restart the API, or top-ups will never be credited.`,
    )
  const proc = run(
    stripe(
      'listen',
      '--api-key',
      key,
      '--events',
      EVENTS,
      '--forward-to',
      forwardTo(local ? 'localhost' : 'host.docker.internal'),
    ),
    'inherit',
  )
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => proc.kill(signal))
  return proc.exited
}

if (import.meta.main) {
  const command = process.argv[2]
  if (command === 'listen') process.exit(await listen())
  else if (command === 'secret') {
    if (!key) {
      console.error('STRIPE_SECRET_KEY is not set (take a test key from the Stripe dashboard)')
      process.exit(1)
    }
    console.log((await printSecret()) ?? 'could not read the signing secret')
  } else {
    console.error('Usage: bun scripts/stripe.ts <listen|secret>')
    process.exit(1)
  }
}
