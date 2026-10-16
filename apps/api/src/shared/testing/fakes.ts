import type {
  Clock,
  IdGenerator,
  ObjectStat,
  ObjectStorage,
  OutboxWriter,
  UnitOfWork,
} from '#/shared/application/ports'
import type { DomainEvent } from '#/shared/domain/domain-event'

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
}
