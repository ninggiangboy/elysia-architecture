import type { Clock, DomainEvent, IdGenerator, UnitOfWork } from '@kit/core'
import { type Mailer, MailPermanentError, MailRateLimitedError } from '@kit/mail'
import type { InboxGuard, OutboxWriter } from '@kit/messaging'
import type { ObjectStat, ObjectStorage } from '@kit/storage'

export class FakeClock implements Clock {
  constructor(private current = new Date('2026-01-01T00:00:00Z')) {}
  now() {
    return new Date(this.current)
  }
  advance(ms: number) {
    this.current = new Date(this.current.getTime() + ms)
  }
}

export class SequentialIds implements IdGenerator {
  private n = 0
  next() {
    return `00000000-0000-7000-8000-${String(++this.n).padStart(12, '0')}`
  }
}

export class InMemoryOutbox implements OutboxWriter {
  events: DomainEvent[] = []
  async add(events: DomainEvent[]) {
    this.events.push(...events)
  }
  types() {
    return this.events.map((e) => e.type)
  }
}

export class PassthroughUnitOfWork implements UnitOfWork {
  run<T>(fn: () => Promise<T>) {
    return fn()
  }
}

export class FakeStorage implements ObjectStorage {
  objects = new Map<string, ObjectStat>()
  /** Bytes of the objects that were written or seeded with content (`objects` only holds their metadata). */
  data = new Map<string, Uint8Array>()
  deleted: string[] = []
  presignPut(key: string) {
    return `http://s3.test/put/${key}`
  }
  presignGet(key: string) {
    return `http://s3.test/get/${key}`
  }
  async stat(key: string) {
    return this.objects.get(key) ?? null
  }
  async read(key: string) {
    return this.data.get(key) ?? null
  }
  async write(key: string, bytes: Uint8Array, contentType: string) {
    this.data.set(key, bytes)
    this.objects.set(key, { size: bytes.byteLength, contentType })
  }
  async delete(key: string) {
    this.deleted.push(key)
    this.objects.delete(key)
    this.data.delete(key)
  }
  async deletePrefix(prefix: string) {
    const keys = [...new Set([...this.objects.keys(), ...this.data.keys()])].filter((k) =>
      k.startsWith(prefix),
    )
    for (const key of keys) await this.delete(key)
    return keys.length
  }
}

/** What `InMemoryInbox.crashAfterNextSideEffect` throws: the process died, nothing past that point ran. */
export class SimulatedCrash extends Error {
  constructor() {
    super('simulated crash between the side effect and the inbox write')
  }
}

/** Runs `fn` once per (messageId, handler), like the real inbox. */
export class InMemoryInbox implements InboxGuard {
  private seen = new Set<string>()
  /** Keys whose `transactional` is running: like a row lock, a concurrent delivery of the same key waits out and does nothing. */
  private running = new Set<string>()
  private crashNext = false

  /**
   * The next `afterSideEffect` runs its `fn` and then "dies" (throws `SimulatedCrash`) before the inbox write,
   * the one window where the real guard delivers twice. The redelivery therefore runs `fn` again.
   */
  crashAfterNextSideEffect() {
    this.crashNext = true
  }

  async transactional(messageId: string, handler: string, fn: () => Promise<void>) {
    const key = `${messageId}:${handler}`
    if (this.seen.has(key) || this.running.has(key)) return
    this.running.add(key)
    try {
      // Like a real transaction: a handler that throws leaves no trace, so the redelivery runs it again.
      await fn()
      this.seen.add(key)
    } finally {
      this.running.delete(key)
    }
  }

  /** Like the real guard: the side effect first, the inbox record after it — so it is not atomic with it. */
  async afterSideEffect(messageId: string, handler: string, fn: () => Promise<void>) {
    const key = `${messageId}:${handler}`
    if (this.seen.has(key)) return
    await fn()
    if (this.crashNext) {
      this.crashNext = false
      throw new SimulatedCrash()
    }
    this.seen.add(key)
  }
}

export interface SentMail {
  to: string
  subject: string
  text: string
  html: string
}

/** Keeps the mails it is given. `failNext…` arms the next send to fail the way a provider does. */
export class MemoryMailer implements Mailer {
  sent: SentMail[] = []
  private failure?: Error

  failNextWith(error: Error) {
    this.failure = error
  }
  failNextPermanently() {
    this.failNextWith(new MailPermanentError('550 no such user'))
  }
  failNextRateLimited() {
    this.failNextWith(new MailRateLimitedError('454 Throttling failure'))
  }

  async send(mail: SentMail) {
    if (this.failure) {
      const error = this.failure
      this.failure = undefined
      throw error
    }
    this.sent.push(mail)
  }

  to(address: string) {
    return this.sent.filter((m) => m.to === address)
  }
}

export interface InMemorySendRateLimiterOptions {
  ratePerSecond: number
  burst: number
  /** 0 = unlimited. */
  dailyQuota: number
}

/** A token bucket with a daily quota, on the real clock — the in-memory twin of the Postgres limiter. */
export class InMemorySendRateLimiter {
  private tokens: number
  private updatedAt = Date.now()
  private day = ''
  private sentToday = 0

  constructor(private options: InMemorySendRateLimiterOptions) {
    this.tokens = options.burst
  }

  private refill() {
    const now = Date.now()
    this.tokens = Math.min(
      this.options.burst,
      this.tokens + ((now - this.updatedAt) / 1000) * this.options.ratePerSecond,
    )
    this.updatedAt = now
  }

  async acquire(): Promise<{ ok: true } | { ok: false; retryAfterMs: number }> {
    this.refill()
    if (this.tokens < 1)
      return {
        ok: false,
        retryAfterMs: Math.ceil(((1 - this.tokens) / this.options.ratePerSecond) * 1000),
      }
    const now = new Date()
    const today = now.toISOString().slice(0, 10)
    if (today !== this.day) [this.day, this.sentToday] = [today, 0]
    if (this.options.dailyQuota > 0 && this.sentToday >= this.options.dailyQuota) {
      const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
      return { ok: false, retryAfterMs: Math.min(midnight - now.getTime() + 1000, 3600_000) }
    }
    this.tokens -= 1
    this.sentToday += 1
    return { ok: true }
  }

  async penalize(ms: number) {
    this.refill()
    this.tokens = Math.min(this.tokens, -(ms / 1000) * this.options.ratePerSecond)
  }
}

/** Per-key mutual exclusion inside one process — the in-memory twin of Postgres advisory locks. */
export class InMemoryAdvisoryLock {
  private held = new Set<string>()

  withLock = async <T>(key: string, fn: () => Promise<T>): Promise<T | undefined> => {
    if (this.held.has(key)) return undefined
    this.held.add(key)
    try {
      return await fn()
    } finally {
      this.held.delete(key)
    }
  }
}
