import type { Clock } from '@kit/core'
import { ForbiddenError } from '@kit/core'

/**
 * Sensitive actions (change email, add/remove a sign-in method…) need a recent strong authentication on top of a valid
 * session, so a stolen access token alone cannot take over the account. The client answers `step_up_required` by confirming
 * with a passkey or an emailed code, which returns a fresh access token carrying a new `auth_time`.
 */
export class StepUpPolicy {
  constructor(
    private clock: Clock,
    private windowSeconds: number,
  ) {}

  /** `authTime` = the `auth_time` claim (epoch seconds) of the access token making the request. */
  assertFresh(authTime: number | undefined): void {
    const nowSeconds = this.clock.now().getTime() / 1000
    if (authTime === undefined || nowSeconds - authTime > this.windowSeconds) {
      throw new ForbiddenError('step_up_required', 'Please confirm it is you to continue')
    }
  }
}
