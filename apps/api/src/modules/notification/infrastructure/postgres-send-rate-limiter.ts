import { sql } from 'drizzle-orm'
import type { ModuleDatabase } from '#/shared/infrastructure/db/module-database'
import type { SendGrant, SendRateLimiter } from '../application/ports'

export interface SendRateLimiterOptions {
  /** Số mail/giây được nạp lại. */
  ratePerSecond: number
  /** Dung lượng bucket (số mail gửi dồn được). */
  burst: number
  /** Quota mỗi ngày UTC; 0 = không giới hạn. */
  dailyQuota: number
  /** Cho phép nhiều bucket độc lập (vd. theo nhà cung cấp) và để test cô lập. */
  key?: string
}

class DailyQuotaExceeded extends Error {}

/**
 * Token bucket + quota ngày, trạng thái nằm trong Postgres nên mọi instance dùng chung một giới hạn.
 * Mỗi lần xin phép là MỘT câu lệnh upsert nguyên tử (khoá dòng) → không vượt tốc độ dù chạy song song.
 */
export class PostgresSendRateLimiter implements SendRateLimiter {
  private readonly key: string

  constructor(
    private mod: ModuleDatabase,
    private options: SendRateLimiterOptions,
  ) {
    this.key = options.key ?? 'mail'
  }

  async acquire(): Promise<SendGrant> {
    const { ratePerSecond: rate, burst: cap, dailyQuota } = this.options
    try {
      // Cùng một transaction: nếu quota ngày hết thì rollback luôn token đã lấy.
      return await this.mod.run(async (): Promise<SendGrant> => {
        const ex = this.mod.executor
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
          // Jitter nhỏ để các message bị từ chối cùng lúc không đồng loạt quay lại.
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
        // Kiểm tra lại sau tối đa 1 giờ (hoặc khi sang ngày mới UTC).
        const now = new Date()
        const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
        return { ok: false, retryAfterMs: Math.min(midnight - now.getTime() + 1000, 3600_000) }
      }
      throw err
    }
  }

  async penalize(ms: number): Promise<void> {
    // Token âm = nợ: cần đủ thời gian nạp lại thì acquire mới thành công trở lại.
    await this.mod.executor.execute(sql`
      insert into notification.rate_buckets as b (key, tokens, updated_at)
      values (${this.key}, ${-(ms / 1000) * this.options.ratePerSecond}::float8, now())
      on conflict (key) do update
        set tokens = least(b.tokens, ${-(ms / 1000) * this.options.ratePerSecond}::float8), updated_at = now()`)
  }
}
