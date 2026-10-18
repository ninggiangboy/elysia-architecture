import { beforeEach, describe, expect, test } from 'bun:test'
import type { Mailer } from '#/shared/mail'
import { MailPermanentError, MailRateLimitedError } from '#/shared/mail'
import type { Envelope, InboxGuard } from '#/shared/messaging'
import { RetryLaterError } from '#/shared/messaging'
import { FakeClock } from '#/shared/testing'
import { MailEventHandler } from './handlers/mail-event-handler'
import type { SendGrant, SendRateLimiter } from './ports'
import { ThrottledMailer } from './throttled-mailer'

const mail = { to: 'a@b.co', subject: 's', text: 't', html: '<p>t</p>' }

class FakeLimiter implements SendRateLimiter {
  grant: SendGrant = { ok: true }
  penalties: number[] = []
  async acquire() {
    return this.grant
  }
  async penalize(ms: number) {
    this.penalties.push(ms)
  }
}

class RecordingMailer implements Mailer {
  sent: (typeof mail)[] = []
  failWith?: Error
  async send(m: typeof mail) {
    if (this.failWith) throw this.failWith
    this.sent.push(m)
  }
}

describe('ThrottledMailer', () => {
  let limiter: FakeLimiter
  let inner: RecordingMailer
  let mailer: ThrottledMailer
  beforeEach(() => {
    limiter = new FakeLimiter()
    inner = new RecordingMailer()
    mailer = new ThrottledMailer(inner, limiter)
  })

  test('sends when the limiter grants a slot', async () => {
    await mailer.send(mail)
    expect(inner.sent).toHaveLength(1)
  })

  test('over the local limit: does not touch the provider and reports exactly when to retry', async () => {
    limiter.grant = { ok: false, retryAfterMs: 740 }
    const err = await mailer.send(mail).catch((e) => e)
    expect(err).toBeInstanceOf(MailRateLimitedError)
    expect(err).toBeInstanceOf(RetryLaterError)
    expect(err.retryAfterMs).toBe(740)
    expect(inner.sent).toHaveLength(0)
  })

  test('provider throttles us anyway: back off every instance, with a default delay if none was hinted', async () => {
    inner.failWith = new MailRateLimitedError('454 Throttling failure')
    const err = await mailer.send(mail).catch((e) => e)
    expect(err).toBeInstanceOf(MailRateLimitedError)
    expect(err.retryAfterMs).toBe(30_000)
    expect(limiter.penalties).toEqual([30_000])

    inner.failWith = new MailRateLimitedError('slow down', 5_000)
    await mailer.send(mail).catch(() => {})
    expect(limiter.penalties).toEqual([30_000, 5_000])
  })

  test('other failures pass through untouched and do not penalise the bucket', async () => {
    inner.failWith = new MailPermanentError('550 no such user')
    await expect(mailer.send(mail)).rejects.toBeInstanceOf(MailPermanentError)
    inner.failWith = new Error('ECONNRESET')
    await expect(mailer.send(mail)).rejects.toThrow('ECONNRESET')
    expect(limiter.penalties).toEqual([])
  })
})

describe('MailEventHandler', () => {
  const done = new Set<string>()
  const inbox: InboxGuard = {
    transactional: async (_id, _h, fn) => fn(),
    afterSideEffect: async (id, handler, fn) => {
      if (done.has(`${id}:${handler}`)) return
      await fn()
      done.add(`${id}:${handler}`)
    },
  }
  const logs: string[] = []
  const log = {
    info: (_f: object, m: string) => logs.push(m),
    warn: (_f: object, m: string) => logs.push(m),
    error: (_f: object, m: string) => logs.push(m),
  }
  let clock: FakeClock
  let inner: RecordingMailer
  const message = (expiresAt?: string): Envelope => ({
    id: Bun.randomUUIDv7(),
    type: 'x.v1',
    source: 'x',
    aggregateId: 'a',
    occurredAt: new Date().toISOString(),
    payload: { expiresAt },
    headers: {},
  })
  const handler = () =>
    new MailEventHandler<{ expiresAt?: string }>(
      'test.handler',
      'x.v1',
      (p) => ({
        to: 'a@b.co',
        content: { subject: 's', text: 't', html: 'h' },
        expiresAt: p.expiresAt,
      }),
      inner,
      inbox,
      clock,
      log,
    )

  beforeEach(() => {
    done.clear()
    logs.length = 0
    clock = new FakeClock(new Date('2026-01-01T00:00:00Z'))
    inner = new RecordingMailer()
  })

  test('sends once; redelivery is a no-op', async () => {
    const m = message()
    await handler().handle(m)
    await handler().handle(m)
    expect(inner.sent).toHaveLength(1)
  })

  test('a link that expired while the mail was waiting out a rate limit is not sent', async () => {
    await handler().handle(message('2025-12-31T23:59:00Z'))
    expect(inner.sent).toHaveLength(0)
    expect(logs).toContain('mail skipped: expired before it could be sent')
  })

  test('a still-valid link is sent', async () => {
    await handler().handle(message('2026-01-01T00:10:00Z'))
    expect(inner.sent).toHaveLength(1)
  })

  test('permanent rejection drops that mail (logged) instead of poisoning the event, and is not retried', async () => {
    inner.failWith = new MailPermanentError('550 5.1.1 User unknown')
    const m = message()
    await expect(handler().handle(m)).resolves.toBeUndefined()
    expect(logs).toContain('mail permanently rejected, dropping')
    inner.failWith = undefined
    await handler().handle(m)
    expect(inner.sent).toHaveLength(0) // inbox already recorded it, not sent again
  })

  test('rate limiting propagates so the relay can defer, and leaves the inbox untouched', async () => {
    inner.failWith = new MailRateLimitedError('throttled', 1000)
    const m = message()
    await expect(handler().handle(m)).rejects.toBeInstanceOf(RetryLaterError)
    inner.failWith = undefined
    await handler().handle(m)
    expect(inner.sent).toHaveLength(1)
  })
})
