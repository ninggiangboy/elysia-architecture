import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { DomainEvent } from '@kit/core'
import type { OutboxWriter } from '@kit/messaging'

export interface OutboxWriterUnderTest {
  writer: OutboxWriter
  /** Runs `fn` inside the unit of work the writer needs (the Postgres one); omit when it needs none. */
  run?<T>(fn: () => Promise<T>): Promise<T>
  /** What has been written so far, oldest first. */
  written(): Promise<Pick<DomainEvent, 'type' | 'aggregateId' | 'payload' | 'occurredAt'>[]>
  /** Set when the writer refuses to write outside a unit of work (a transactional outbox must). */
  requiresUnitOfWork?: boolean
  cleanup?(): Promise<void>
}

const event = (type: string, n = 0): DomainEvent => ({
  type,
  aggregateId: `agg-${crypto.randomUUID()}`,
  payload: { n, nested: { list: [1, 'two', null], flag: true }, text: 'héllo' },
  occurredAt: new Date(Date.UTC(2026, 0, 1, 0, 0, n)),
})

/** The transactional outbox's write side: events are kept whole, in order, and only inside a unit of work. */
export function describeOutboxWriter(
  name: string,
  make: () => Promise<OutboxWriterUnderTest> | OutboxWriterUnderTest,
) {
  describe(`OutboxWriter contract: ${name}`, () => {
    let sut: OutboxWriterUnderTest
    beforeEach(async () => {
      sut = await make()
    })
    afterEach(async () => {
      await sut.cleanup?.()
    })
    const inUnit = <T>(fn: () => Promise<T>) => (sut.run ? sut.run(fn) : fn())

    test('keeps type, aggregate, payload and time of each event', async () => {
      const e = event('test.thing_happened.v1', 7)
      await inUnit(() => sut.writer.add([e]))
      const [stored] = await sut.written()
      expect(stored).toMatchObject({ type: e.type, aggregateId: e.aggregateId, payload: e.payload })
      expect(new Date(stored?.occurredAt as Date).getTime()).toBe(e.occurredAt.getTime())
    })

    test('keeps the order of the events of one call and of successive calls', async () => {
      await inUnit(() => sut.writer.add([event('t.a.v1', 1), event('t.b.v1', 2)]))
      await inUnit(() => sut.writer.add([event('t.c.v1', 3)]))
      expect((await sut.written()).map((e) => e.type)).toEqual(['t.a.v1', 't.b.v1', 't.c.v1'])
    })

    test('writing nothing is fine and writes nothing', async () => {
      await inUnit(() => sut.writer.add([]))
      expect(await sut.written()).toEqual([])
    })

    test('refuses to write outside a unit of work when the adapter is transactional', async () => {
      if (!sut.requiresUnitOfWork) return
      await expect(sut.writer.add([event('t.a.v1')])).rejects.toThrow()
      expect(await sut.written()).toEqual([])
    })
  })
}
