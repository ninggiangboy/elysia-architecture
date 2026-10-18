import type { Clock, DomainEvent, IdGenerator, UnitOfWork } from '@kit/core'
import type { InboxGuard, OutboxWriter } from '#/shared/messaging'
import type { ObjectStat, ObjectStorage } from '#/shared/storage'

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
    if (this.seen.has(key)) return
    // Like a real transaction: a handler that throws leaves no trace, so the redelivery runs it again.
    await fn()
    this.seen.add(key)
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
