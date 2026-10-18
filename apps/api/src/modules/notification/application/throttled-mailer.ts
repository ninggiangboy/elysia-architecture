import type { Mailer } from '#/shared/mail'
import { MailRateLimitedError } from '#/shared/mail'
import type { SendRateLimiter } from './ports'

const DEFAULT_PENALTY_MS = 30_000

/**
 * Wraps a real Mailer with a proactive rate limiter. Two layers of protection:
 *  1. Proactive: never send more than `MAIL_RATE_PER_SECOND` / the daily quota → throws MailRateLimitedError (exact retryAfter).
 *  2. Adaptive: if the provider still reports overload, block every instance for a while (penalize),
 *     so instances do not keep hammering the provider.
 * When the relay sees MailRateLimitedError it defers the message without counting an attempt.
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
