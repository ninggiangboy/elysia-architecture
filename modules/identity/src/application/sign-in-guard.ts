import type { Clock, IdGenerator } from '@kit/core'
import {
  SIGN_IN_FAILURE_WINDOW_MS,
  SIGN_IN_MAX_FAILURES_PER_EMAIL,
  SIGN_IN_MAX_FAILURES_PER_IP,
} from '../domain/password'
import type { SignInFailureRepository } from '../domain/repositories'
import { assertUnderLimit } from './throttle'

/**
 * Slows down guessing of passwords and sign-in codes: failures are counted per address (someone attacking one account)
 * and per IP (someone trying many). Record a failure outside the use case's transaction, or the rollback drops it.
 */
export class SignInGuard {
  constructor(
    private failures: SignInFailureRepository,
    private ids: IdGenerator,
    private clock: Clock,
  ) {}

  async assertAllowed(email: string, ip: string): Promise<void> {
    const now = this.clock.now()
    const since = new Date(now.getTime() - SIGN_IN_FAILURE_WINDOW_MS)
    const [byEmail, byIp] = await Promise.all([
      this.failures.since({ email }, since),
      this.failures.since({ ip }, since),
    ])
    assertUnderLimit({
      seen: byEmail,
      max: SIGN_IN_MAX_FAILURES_PER_EMAIL,
      windowMs: SIGN_IN_FAILURE_WINDOW_MS,
      now,
      code: 'sign_in_rate_limited',
    })
    assertUnderLimit({
      seen: byIp,
      max: SIGN_IN_MAX_FAILURES_PER_IP,
      windowMs: SIGN_IN_FAILURE_WINDOW_MS,
      now,
      code: 'sign_in_rate_limited',
    })
  }

  async recordFailure(email: string, ip: string, method: string): Promise<void> {
    await this.failures.record({ id: this.ids.next(), email, ip, method, at: this.clock.now() })
  }
}
