import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

/** Runs `fn` only if nobody else holds the lock for `key`; `undefined` when someone does. Released when `fn` ends, however it ends. */
export type WithLock = <T>(key: string, fn: () => Promise<T>) => Promise<T | undefined>

export interface AdvisoryLockUnderTest {
  withLock: WithLock
  cleanup?(): Promise<void>
}

export function describeAdvisoryLock(
  name: string,
  make: () => Promise<AdvisoryLockUnderTest> | AdvisoryLockUnderTest,
) {
  describe(`AdvisoryLock contract: ${name}`, () => {
    let sut: AdvisoryLockUnderTest
    beforeEach(async () => {
      sut = await make()
    })
    afterEach(async () => {
      await sut.cleanup?.()
    })
    const key = () => `contract-${crypto.randomUUID()}`

    test('runs the function when free and returns what it returns', async () => {
      expect(await sut.withLock(key(), async () => 42)).toBe(42)
    })

    test('while it is held, another try for the same key does not run and answers undefined', async () => {
      const k = key()
      let release: () => void = () => {}
      let holding: () => void = () => {}
      const held = new Promise<void>((resolve) => {
        holding = resolve
      })
      const first = sut.withLock(k, async () => {
        holding()
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return 'first'
      })
      await held
      let ran = false
      const second = await sut.withLock(k, async () => {
        ran = true
        return 'second'
      })
      expect(second).toBeUndefined()
      expect(ran).toBe(false)
      release()
      expect(await first).toBe('first')
    })

    test('other keys are not blocked', async () => {
      let release: () => void = () => {}
      let holding: () => void = () => {}
      const held = new Promise<void>((resolve) => {
        holding = resolve
      })
      const first = sut.withLock(key(), async () => {
        holding()
        await new Promise<void>((resolve) => {
          release = resolve
        })
      })
      await held
      expect(await sut.withLock(key(), async () => 'other')).toBe('other')
      release()
      await first
    })

    test('is released when the function ends, also when it throws', async () => {
      const k = key()
      await expect(
        sut.withLock(k, async () => {
          throw new Error('boom')
        }),
      ).rejects.toThrow('boom')
      expect(await sut.withLock(k, async () => 'again')).toBe('again')
    })
  })
}
