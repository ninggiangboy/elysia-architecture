import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { Mailer } from '@kit/mail'
import { MailPermanentError, MailRateLimitedError } from '@kit/mail'
import { eq, sql } from 'drizzle-orm'
import { IdentityEvents } from '#/modules/identity/contracts'
import { outbox as identityOutbox } from '#/modules/identity/infrastructure/persistence/schema'
import { PostgresSendRateLimiter } from '#/modules/notification/infrastructure/postgres-send-rate-limiter'
import { createTestApp, eventually, sleep, type TestApp, uniqueEmail } from './helpers'

type Mail = Parameters<Mailer['send']>[0]

/** Scripted fake mailer: the test decides whether each send succeeds or fails. */
class ScriptedMailer implements Mailer {
  sent: Mail[] = []
  calls: Mail[] = []
  behavior: (mail: Mail, call: number) => void = () => {}
  async send(mail: Mail) {
    this.calls.push(mail)
    this.behavior(mail, this.calls.filter((c) => c.to === mail.to).length)
    this.sent.push(mail)
  }
  to(address: string) {
    return this.sent.filter((m) => m.to === address)
  }
  callsTo(address: string) {
    return this.calls.filter((m) => m.to === address)
  }
}

let t: TestApp
const mailer = new ScriptedMailer()
const identity = () => t.container.database.db

beforeAll(async () => {
  t = await createTestApp({ mailer })
})
afterAll(async () => {
  await t.container.close()
})

async function emit(type: string, payload: Record<string, unknown>, occurredAt = new Date()) {
  const id = Bun.randomUUIDv7()
  await identity()
    .insert(identityOutbox)
    .values({ id, type, aggregateId: id, payload, headers: {}, occurredAt })
  return id
}
const registered = (email: string) => ({
  userId: Bun.randomUUIDv7(),
  email,
  registeredAt: new Date().toISOString(),
})
const outboxRow = async (id: string) =>
  (await identity().select().from(identityOutbox).where(eq(identityOutbox.id, id)))[0]!

describe('PostgresSendRateLimiter (shared state, safe across instances)', () => {
  const limiter = (key: string, o: { rate?: number; burst?: number; quota?: number } = {}) =>
    new PostgresSendRateLimiter(t.container.database, {
      key,
      ratePerSecond: o.rate ?? 5,
      burst: o.burst ?? 3,
      dailyQuota: o.quota ?? 0,
    })
  const key = (name: string) => `${name}-${Bun.randomUUIDv7()}`

  test('allows a burst, then says exactly how long to wait, then allows again', async () => {
    const l = limiter(key('burst')) // 5/s, burst 3
    for (let i = 0; i < 3; i++) expect(await l.acquire()).toEqual({ ok: true })
    const denied = await l.acquire()
    expect(denied.ok).toBe(false)
    if (denied.ok) return
    expect(denied.retryAfterMs).toBeGreaterThan(0)
    expect(denied.retryAfterMs).toBeLessThanOrEqual(400) // 1 token = 200ms (+ jitter)
    await sleep(denied.retryAfterMs + 30)
    expect(await l.acquire()).toEqual({ ok: true })
  })

  test('many instances racing never exceed the burst', async () => {
    const k = key('race')
    const instances = Array.from({ length: 4 }, () => limiter(k, { rate: 0.001, burst: 5 }))
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) => instances[i % 4]!.acquire()),
    )
    expect(results.filter((r) => r.ok)).toHaveLength(5)
  })

  test('penalize blocks every instance for about the requested time', async () => {
    const k = key('penalty')
    const a = limiter(k, { rate: 10, burst: 5 })
    const b = limiter(k, { rate: 10, burst: 5 })
    await a.penalize(1000)
    const denied = await b.acquire()
    expect(denied.ok).toBe(false)
    if (denied.ok) return
    expect(denied.retryAfterMs).toBeGreaterThan(800)
    expect(denied.retryAfterMs).toBeLessThan(1500)
  })

  test('daily quota is enforced and a refused attempt does not burn a rate token', async () => {
    const k = key('daily')
    const l = limiter(k, { rate: 0.001, burst: 10, quota: 2 })
    expect(await l.acquire()).toEqual({ ok: true })
    expect(await l.acquire()).toEqual({ ok: true })
    const denied = await l.acquire()
    expect(denied.ok).toBe(false)
    if (denied.ok) return
    expect(denied.retryAfterMs).toBeGreaterThan(0)
    expect(denied.retryAfterMs).toBeLessThanOrEqual(3600_000)
    const [row] = await t.container.database.db.execute<{ tokens: number }>(
      sql`select tokens from notification.rate_buckets where key = ${k}`,
    )
    expect(Number(row?.tokens)).toBeCloseTo(8, 1) // 10 - 2 mails sent; the rejected attempt is given back
  })
})

describe('outbox + mail under provider rate limiting', () => {
  test('a throttled provider only delays the mail: no attempts are burned and it is sent once', async () => {
    const email = uniqueEmail('throttled')
    mailer.behavior = (m, call) => {
      if (m.to === email && call <= 2) throw new MailRateLimitedError('454 Throttling failure', 300)
    }
    const id = await emit(IdentityEvents.UserRegistered, registered(email))

    await eventually(
      async () => mailer.to(email).length === 1,
      15_000,
      'welcome mail after throttling',
    )
    await eventually(async () => (await outboxRow(id)).publishedAt, 5_000, 'message published')

    expect(mailer.callsTo(email)).toHaveLength(3) // 2 deferred + 1 successful
    const row = await outboxRow(id)
    expect(row.attempts).toBe(1) // deferral due to rate limit does not count as an attempt
    expect(row.deadAt).toBeNull()
  }, 20_000)

  test('a permanently rejected address is dropped without dead-lettering the event or blocking other consumers', async () => {
    const email = uniqueEmail('bounce')
    mailer.behavior = (m) => {
      if (m.to === email) throw new MailPermanentError('550 5.1.1 User unknown')
    }
    const payload = registered(email)
    const id = await emit(IdentityEvents.UserRegistered, payload)

    await eventually(async () => (await outboxRow(id)).publishedAt, 10_000, 'message published')
    const row = await outboxRow(id)
    expect(row.deadAt).toBeNull()
    expect(row.attempts).toBe(1)
    expect(mailer.to(email)).toHaveLength(0)
    // Another consumer of the same event (create profile) still runs normally
    const profiles = await t.container.database.db.execute(
      sql`select 1 from profile.profiles where user_id = ${payload.userId}`,
    )
    expect(profiles).toHaveLength(1)
  })

  test('a magic link that expired while waiting is never sent', async () => {
    const email = uniqueEmail('expired')
    mailer.behavior = () => {}
    const id = await emit(IdentityEvents.MagicLinkRequested, {
      email,
      token: 'stale-token',
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    })
    await eventually(async () => (await outboxRow(id)).publishedAt, 10_000, 'message published')
    expect(mailer.callsTo(email)).toHaveLength(0)
  })

  test('rate limiting that outlasts the deferral budget dead-letters the message; requeue revives it', async () => {
    const email = uniqueEmail('longoutage')
    let outage = true
    mailer.behavior = (m) => {
      if (m.to === email && outage) throw new MailRateLimitedError('daily quota exceeded', 100)
    }
    // The event is already 25 hours old → exceeds the 24-hour deferral budget on the very first deferral
    const id = await emit(
      IdentityEvents.UserRegistered,
      registered(email),
      new Date(Date.now() - 25 * 3600_000),
    )
    await eventually(async () => (await outboxRow(id)).deadAt, 10_000, 'dead-lettered')
    expect((await outboxRow(id)).lastError).toContain('deferred')

    outage = false
    const proc = Bun.spawn(['bun', 'scripts/outbox.ts', 'requeue', '--id', id], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    expect(await new Response(proc.stdout).text()).toContain('1 message(s) requeued')
    await proc.exited

    await eventually(async () => mailer.to(email).length === 1, 10_000, 'mail after requeue')
    // The relay marks the message published just after the handler returns, so wait for it.
    await eventually(async () => (await outboxRow(id)).publishedAt, 10_000, 'message published')
    expect((await outboxRow(id)).deadAt).toBeNull()
  }, 25_000)
})
