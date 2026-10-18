import type { Clock, UnitOfWork } from '@kit/core'
import { NotFoundError } from '@kit/core'
import type { OutboxWriter } from '#/shared/messaging'
import type { DeviceSession } from '../../domain/refresh-token'
import type { RefreshTokenRepository } from '../../domain/repositories'
import { sessionRevoked } from '../session-events'

export type DeviceSessionView = DeviceSession & { current: boolean }

/** Lists the devices signed in to the account. `current` marks the session making the request. */
export class ListSessions {
  constructor(
    private refreshTokens: RefreshTokenRepository,
    private clock: Clock,
  ) {}

  async execute(query: { userId: string; currentSessionId: string }): Promise<DeviceSessionView[]> {
    const sessions = await this.refreshTokens.listActiveSessions(query.userId, this.clock.now())
    return sessions.map((s) => ({ ...s, current: s.id === query.currentSessionId }))
  }
}

/**
 * Remote logout of one device. Refresh tokens die immediately; an access token already issued to that device
 * stays valid until it expires (≤ ACCESS_TOKEN_TTL) because access tokens are verified statelessly.
 * The `session_revoked` event lets realtime push the news to the device so it can sign itself out right away.
 */
export class RevokeSession {
  constructor(
    private refreshTokens: RefreshTokenRepository,
    private outbox: OutboxWriter,
    private uow: UnitOfWork,
    private clock: Clock,
  ) {}

  async execute(cmd: { userId: string; sessionId: string }): Promise<void> {
    const now = this.clock.now()
    const revoked = await this.uow.run(async () => {
      const ok = await this.refreshTokens.revokeUserSession(cmd.userId, cmd.sessionId, now)
      if (ok) await this.outbox.add([sessionRevoked({ ...cmd, reason: 'revoked_by_user' }, now)])
      return ok
    })
    if (!revoked) throw new NotFoundError('session_not_found', 'Session not found')
  }
}

/** "Sign out everywhere else": keeps only the session making the request. */
export class RevokeOtherSessions {
  constructor(
    private refreshTokens: RefreshTokenRepository,
    private outbox: OutboxWriter,
    private uow: UnitOfWork,
    private clock: Clock,
  ) {}

  async execute(cmd: { userId: string; currentSessionId: string }): Promise<{ revoked: number }> {
    const now = this.clock.now()
    const ids = await this.uow.run(async () => {
      const revoked = await this.refreshTokens.revokeOtherSessions(
        cmd.userId,
        cmd.currentSessionId,
        now,
      )
      await this.outbox.add(
        revoked.map((sessionId) =>
          sessionRevoked({ userId: cmd.userId, sessionId, reason: 'revoked_by_user' }, now),
        ),
      )
      return revoked
    })
    return { revoked: ids.length }
  }
}
