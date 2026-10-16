import { MailRateLimitedError } from '#/shared/application/mail-errors'
import type { Mailer } from '#/shared/application/ports'
import type { SendRateLimiter } from './ports'

const DEFAULT_PENALTY_MS = 30_000

/**
 * Bọc một Mailer thật bằng bộ giới hạn tốc độ chủ động. Hai lớp bảo vệ:
 *  1. Chủ động: không gửi quá `MAIL_RATE_PER_SECOND` / quota ngày → ném MailRateLimitedError(retryAfter chính xác).
 *  2. Thích ứng: nếu nhà cung cấp vẫn báo quá tải thì chặn toàn bộ instance một khoảng (penalize),
 *     tránh việc mỗi instance tiếp tục đập vào nhà cung cấp.
 * Relay thấy MailRateLimitedError sẽ hoãn message mà không tính số lần thử.
 */
export class ThrottledMailer implements Mailer {
  constructor(
    private inner: Mailer,
    private limiter: SendRateLimiter,
  ) {}

  async send(mail: Parameters<Mailer['send']>[0]): Promise<void> {
    const grant = await this.limiter.acquire()
    if (!grant.ok) {
      throw new MailRateLimitedError('mail send rate limit reached', grant.retryAfterMs)
    }
    try {
      await this.inner.send(mail)
    } catch (err) {
      if (err instanceof MailRateLimitedError) {
        const ms = err.retryAfterMs ?? DEFAULT_PENALTY_MS
        await this.limiter.penalize(ms)
        throw new MailRateLimitedError(err.message, ms)
      }
      throw err
    }
  }
}
