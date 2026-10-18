import { afterEach, describe, expect, test } from 'bun:test'

export type SendGrant = { ok: true } | { ok: false; retryAfterMs: number }

/** The port the notification module throttles its mails through (a token bucket plus a daily quota, shared by every instance). */
export interface SendRateLimiter {
  acquire(): Promise<SendGrant>
  penalize(ms: number): Promise<void>
}

export interface SendRateLimiterOptions {
  ratePerSecond: number
  burst: number
  /** 0 = unlimited. */
  dailyQuota: number
  /** Separates this test's bucket from every other one sharing the store. */
  key: string
}

export interface SendRateLimiterUnderTest {
  limiter: SendRateLimiter
  cleanup?(): Promise<void>
}

/** A token bucket: a burst goes out at once, then the rate rules; the answer to "no" says when to come back. */
export function describeSendRateLimiter(
  name: string,
  make: (
    options: SendRateLimiterOptions,
  ) => Promise<SendRateLimiterUnderTest> | SendRateLimiterUnderTest,
) {
  describe(`SendRateLimiter contract: ${name}`, () => {
    const cleanups: (() => Promise<void>)[] = []
    afterEach(async () => {
      for (const cleanup of cleanups.splice(0)) await cleanup()
    })
    const build = async (options: Partial<SendRateLimiterOptions>) => {
      const sut = await make({
        ratePerSecond: 20,
        burst: 3,
        dailyQuota: 0,
        key: `contract-${crypto.randomUUID()}`,
        ...options,
      })
      if (sut.cleanup) cleanups.push(sut.cleanup)
      return sut.limiter
    }

    test('lets a burst through, then says no and when to come back', async () => {
      const limiter = await build({ burst: 3, ratePerSecond: 20 })
      for (let i = 0; i < 3; i++) expect(await limiter.acquire()).toEqual({ ok: true })
      const refused = await limiter.acquire()
      expect(refused.ok).toBe(false)
      if (!refused.ok) {
        expect(refused.retryAfterMs).toBeGreaterThan(0)
        expect(refused.retryAfterMs).toBeLessThanOrEqual(1000)
      }
    })

    test('grants again once the time it named has passed', async () => {
      const limiter = await build({ burst: 1, ratePerSecond: 20 })
      expect((await limiter.acquire()).ok).toBe(true)
      const refused = await limiter.acquire()
      if (refused.ok) throw new Error('expected a refusal')
      await Bun.sleep(refused.retryAfterMs + 50)
      expect((await limiter.acquire()).ok).toBe(true)
    })

    test('a penalty blocks sending until it is paid off', async () => {
      const limiter = await build({ burst: 5, ratePerSecond: 20 })
      await limiter.penalize(400)
      const refused = await limiter.acquire()
      expect(refused.ok).toBe(false)
      await Bun.sleep(550)
      expect((await limiter.acquire()).ok).toBe(true)
    })

    test('the daily quota ends the day however fast the bucket refills', async () => {
      const limiter = await build({ burst: 10, ratePerSecond: 1000, dailyQuota: 2 })
      expect((await limiter.acquire()).ok).toBe(true)
      expect((await limiter.acquire()).ok).toBe(true)
      const refused = await limiter.acquire()
      expect(refused.ok).toBe(false)
      if (!refused.ok) expect(refused.retryAfterMs).toBeGreaterThan(1000)
    })

    test('buckets with different keys do not share tokens', async () => {
      const [a, b] = [await build({ burst: 1 }), await build({ burst: 1 })]
      expect((await a.acquire()).ok).toBe(true)
      expect((await b.acquire()).ok).toBe(true)
    })
  })
}
