import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { buildApp } from '../../src/app'
import { loadAppConfig } from '../../src/bootstrap/config'
import { createContainer } from '../../src/bootstrap/container'

// The starter against its own `.env` (bun run keys:generate && bun run db:migrate first): only Postgres is needed. No S3,
// no SMTP, no Stripe, no VAPID: files go to the disk, mail goes to the log.

const logged: { fields: Record<string, unknown>; message: string }[] = []
const log = {
  info: (fields: object, message: string) =>
    void logged.push({ fields: fields as Record<string, unknown>, message }),
  warn() {},
  error() {},
  debug() {},
  fatal() {},
  trace() {},
  child: () => log,
  level: 'silent',
}

type Container = Awaited<ReturnType<typeof createContainer>>
let container: Container
let app: ReturnType<typeof buildApp>

beforeAll(async () => {
  const config = loadAppConfig({ ...process.env, OUTBOX_POLL_INTERVAL_MS: '200' })
  container = await createContainer(config, log as never)
  container.startWorker()
  app = buildApp(container)
})

afterAll(async () => {
  await container.close()
})

const call = async (method: string, path: string, body?: unknown, token?: string) => {
  const res = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
  const text = await res.text()
  return { status: res.status, json: text ? JSON.parse(text) : undefined }
}

describe('starter', () => {
  test('runs on the disk and the log: no S3, SMTP, Stripe or VAPID in its configuration', () => {
    const { config } = container
    expect(config.storage.STORAGE_DRIVER).toBe('local')
    expect(config.mail.MAIL_DRIVER).toBe('console')
    // Whatever `kit:add` installed on top of these two.
    expect(Object.keys(container.modules)).toEqual(expect.arrayContaining(['identity', 'profile']))
  })

  test('is ready', async () => {
    const ready = await call('GET', '/api/health/ready')
    expect(ready.status).toBe(200)
    expect(ready.json).toMatchObject({ status: 'ready', database: 'up' })
  })

  test('signs in with a magic link, taken from the log', async () => {
    const email = `starter-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`
    expect((await call('POST', '/api/auth/magic-link', { email })).status).toBe(202)

    let url: string | undefined
    const deadline = Date.now() + 10_000
    while (!url && Date.now() < deadline) {
      url = logged.find((l) => l.fields.to === email && typeof l.fields.url === 'string')?.fields
        .url as string | undefined
      if (!url) await Bun.sleep(100)
    }
    if (!url) throw new Error('the sign-in link never reached the log')

    const token = new URL(url).searchParams.get('token')
    const verified = await call('POST', '/api/auth/magic-link/verify', { token })
    expect(verified.status).toBe(200)
    const me = await call('GET', '/api/me', undefined, verified.json.accessToken)
    expect(me.status).toBe(200)
    expect(me.json.email).toBe(email)
  })
})
