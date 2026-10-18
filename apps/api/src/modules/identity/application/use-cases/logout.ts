import type { Clock, UnitOfWork } from '#/shared/core'
import type { OutboxWriter } from '#/shared/messaging'
import type { RefreshTokenRepository } from '../../domain/repositories'
import { sessionRevoked } from '../session-events'

export class Logout {
  constructor(
    private refreshTokens: RefreshTokenRepository,
    private outbox: OutboxWriter,
    private uow: UnitOfWork,
    private clock: Clock,
  ) {}

  /** Revokes the whole family → every refresh token of this session is invalidated. The access token expires on its own within ≤ TTL. */
  async execute(cmd: { userId: string; sessionId: string }): Promise<void> {
    const now = this.clock.now()
    await this.uow.run(async () => {
      const revoked = await this.refreshTokens.revokeUserSession(cmd.userId, cmd.sessionId, now)
      if (revoked) {
        await this.outbox.add([sessionRevoked({ ...cmd, reason: 'logout' }, now)])
      }
    })
  }
}
