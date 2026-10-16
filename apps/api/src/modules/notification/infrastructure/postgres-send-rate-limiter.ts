import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/infrastructure/db/database'
import type { SendGrant, SendRateLimiter } from '../application/ports'

export interface SendRateLimiterOptions {
  /** Mails per second refilled. */
  ratePerSecond: number
  /** Bucket capacity (how many mails can be sent in a burst). */
  burst: number
  /** Quota per UTC day; 0 = unlimited. */
  dailyQuota: number
  /** Allows several independent buckets (e.g. per provider) and isolates tests. */
  key?: string
}

class DailyQuotaExceeded extends Error {}

/**
 * Token bucket + daily quota; state lives in Postgres so every instance shares one limit.
 * Each permission request is ONE atomic upsert statement (row lock) → the rate is never exceeded even when run in parallel.
 */
export class PostgresSendRateLimiter implements SendRateLimiter {
  private readonly key: string

  constructor(
    private database: Database,
    private options: SendRateLimiterOptions,
  ) {
    this.key = options.key ?? 'mail'
  }

  async acquire(): Promise<SendGrant> {
    const { ratePerSecond: rate, burst: cap, dailyQuota } = this.options
    try {
      // Same transaction: if the daily quota is exhausted, the token already taken is rolled back too.
      return await this.database.run(async (): Promise<SendGrant> => {
        const ex = this.database.executor
        const taken = await ex.execute<{ tokens: number }>(sql`
          insert into notification.rate_buckets as b (key, tokens, updated_at)
          values (${this.key}, ${cap}::float8 - 1, now())
          on conflict (key) do update
            set tokens = least(${cap}::float8, b.tokens + extract(epoch from (now() - b.updated_at)) * ${rate}::float8) - 1,
                updated_at = now()
            where least(${cap}::float8, b.tokens + extract(epoch from (now() - b.updated_at)) * ${rate}::float8) >= 1
          returning tokens`)
        if (taken.length === 0) {
          const [row] = await ex.execute<{ wait_ms: number }>(sql`
            select greatest(0, (1 - least(${cap}::float8, tokens + extract(epoch from (now() - updated_at)) * ${rate}::float8)) / ${rate}::float8) * 1000 as wait_ms
            from notification.rate_buckets where key = ${this.key}`)
          // Small jitter so messages rejected at the same time do not all come back at once.
          return {
            ok: false,
            retryAfterMs:
              Math.ceil(Number(row?.wait_ms ?? 1000 / rate)) + Math.floor(Math.random() * 100),
          }
        }

        if (dailyQuota > 0) {
          const counted = await ex.execute(sql`
            insert into notification.mail_quota as q (key, day, sent)
            values (${this.key}, (now() at time zone 'utc')::date, 1)
            on conflict (key, day) do update set sent = q.sent + 1
              where q.sent < ${dailyQuota}
            returning sent`)
          if (counted.length === 0) throw new DailyQuotaExceeded()
        }
        return { ok: true }
      })
    } catch (err) {
      if (err instanceof DailyQuotaExceeded) {
        // Check again after at most 1 hour (or when the UTC day rolls over).
        const now = new Date()
        const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
        return { ok: false, retryAfterMs: Math.min(midnight - now.getTime() + 1000, 3600_000) }
      }
      throw err
    }
  }

  async penalize(ms: number): Promise<void> {
    // Negative tokens = debt: enough refill time must pass before acquire succeeds again.
    await this.database.executor.execute(sql`
      insert into notification.rate_buckets as b (key, tokens, updated_at)
      values (${this.key}, ${-(ms / 1000) * this.options.ratePerSecond}::float8, now())
      on conflict (key) do update
        set tokens = least(b.tokens, ${-(ms / 1000) * this.options.ratePerSecond}::float8), updated_at = now()`)
  }
}
