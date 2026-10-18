import type { Clock } from '@kit/core'
import type { OutboxWriter } from '@kit/messaging'
import type { RefreshTokenRepository } from '../domain/repositories'
import { sessionRevoked } from './session-events'

/** Ends sessions after something that makes them untrustworthy (a password change), and tells the devices. */
export class SessionRevocation {
  constructor(
    private refreshTokens: RefreshTokenRepository,
    private outbox: OutboxWriter,
    private clock: Clock,
  ) {}

  /** Every session of the user, or every one but `exceptSessionId`. Call inside the UnitOfWork. */
  async afterPasswordChange(userId: string, exceptSessionId?: string): Promise<void> {
    const now = this.clock.now()
    const ended = exceptSessionId
      ? await this.refreshTokens.revokeOtherSessions(userId, exceptSessionId, now)
      : await this.refreshTokens.revokeAllSessions(userId, now)
    await this.outbox.add(
      ended.map((sessionId) =>
        sessionRevoked({ userId, sessionId, reason: 'password_changed' }, now),
      ),
    )
  }
}
