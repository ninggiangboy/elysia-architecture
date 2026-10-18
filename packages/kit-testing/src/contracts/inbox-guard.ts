import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { InboxGuard } from '@kit/messaging'

export interface InboxGuardUnderTest {
  guard: InboxGuard
  /**
   * Arms the one failure the real guard cannot hide: the process dies after the side effect and before the inbox write.
   * Provide it when the adapter can simulate that (the in-memory one); the crash scenarios are skipped without it.
   */
  crashAfterNextSideEffect?(): void
  /** Runs `fn` the way a handler runs: inside a unit of work when the guard needs one (the Postgres guard). */
  run?<T>(fn: () => Promise<T>): Promise<T>
  cleanup?(): Promise<void>
}

/** Consumer-side deduplication: each (message, handler) takes effect once. Message ids are UUIDs (the Postgres column is a uuid). */
export function describeInboxGuard(
  name: string,
  make: () => Promise<InboxGuardUnderTest> | InboxGuardUnderTest,
) {
  describe(`InboxGuard contract: ${name}`, () => {
    let sut: InboxGuardUnderTest
    beforeEach(async () => {
      sut = await make()
    })
    afterEach(async () => {
      await sut.cleanup?.()
    })
    const message = () => crypto.randomUUID()
    const counter = () => {
      let runs = 0
      return {
        run: async () => void runs++,
        get runs() {
          return runs
        },
      }
    }

    for (const mode of ['transactional', 'afterSideEffect'] as const) {
      describe(mode, () => {
        test('runs once per (message, handler); a redelivery does nothing', async () => {
          const id = message()
          const c = counter()
          await sut.guard[mode](id, 'h', c.run)
          await sut.guard[mode](id, 'h', c.run)
          expect(c.runs).toBe(1)
        })

        test('another handler of the same message, and the same handler of another message, run on their own', async () => {
          const id = message()
          const c = counter()
          await sut.guard[mode](id, 'h1', c.run)
          await sut.guard[mode](id, 'h2', c.run)
          await sut.guard[mode](message(), 'h1', c.run)
          expect(c.runs).toBe(3)
        })

        test('a handler that throws leaves no trace: the redelivery runs it again', async () => {
          const id = message()
          const c = counter()
          await expect(
            sut.guard[mode](id, 'h', async () => {
              throw new Error('boom')
            }),
          ).rejects.toThrow('boom')
          await sut.guard[mode](id, 'h', c.run)
          await sut.guard[mode](id, 'h', c.run)
          expect(c.runs).toBe(1)
        })
      })
    }

    test('transactional: two deliveries at the same time run the handler once', async () => {
      const id = message()
      const c = counter()
      await Promise.all([
        sut.guard.transactional(id, 'h', c.run),
        sut.guard.transactional(id, 'h', c.run),
      ])
      expect(c.runs).toBe(1)
    })

    test('afterSideEffect: a crash between the side effect and the inbox write means it runs again, once', async () => {
      if (!sut.crashAfterNextSideEffect) return // the adapter cannot simulate a crash
      const id = message()
      const c = counter()
      sut.crashAfterNextSideEffect()
      await expect(sut.guard.afterSideEffect(id, 'h', c.run)).rejects.toThrow()
      await sut.guard.afterSideEffect(id, 'h', c.run)
      await sut.guard.afterSideEffect(id, 'h', c.run)
      expect(c.runs).toBe(2)
    })
  })
}
