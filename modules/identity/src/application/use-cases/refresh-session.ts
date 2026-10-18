import type { Clock, IdGenerator, UnitOfWork } from '@kit/core'
import { UnauthorizedError } from '@kit/core'
import type { OutboxWriter } from '@kit/messaging'
import type { RefreshTokenRepository, UserRepository } from '../../domain/repositories'
import type { SessionResult } from '../auth-outcome'
import type { TokenService } from '../ports'
import { sessionRevoked } from '../session-events'
import type { SessionIssuer, SessionMeta } from '../session-issuer'

export class RefreshSession {
  constructor(
    private refreshTokens: RefreshTokenRepository,
    private users: UserRepository,
    private sessions: SessionIssuer,
    private tokens: TokenService,
    private outbox: OutboxWriter,
    private uow: UnitOfWork,
    private ids: IdGenerator,
    private clock: Clock,
  ) {}

  async execute(cmd: { refreshToken: string; meta: SessionMeta }): Promise<SessionResult> {
    const now = this.clock.now()
    const hash = this.tokens.hashOpaqueToken(cmd.refreshToken)

    // Return null (instead of throwing) inside the transaction so the family revocation is COMMITTED before reporting the error.
    const result = await this.uow.run(async () => {
      const nextTokenId = this.ids.next()
      const old = await this.refreshTokens.consume(hash, nextTokenId, now)
      if (!old) {
        const known = await this.refreshTokens.findByHash(hash)
        // Rotated moments ago: another tab of the same browser refreshed first. Not theft, and the session lives on
        // in the cookie that request set — the caller must not clear it.
        if (known?.isRecentlyRotated(now)) return 'rotated' as const
        // A rotated token that is used again → treat as stolen, revoke the whole session.
        if (known) {
          const revoked = await this.refreshTokens.revokeUserSession(
            known.userId,
            known.familyId,
            now,
          )
          if (revoked) {
            await this.outbox.add([
              sessionRevoked(
                { userId: known.userId, sessionId: known.familyId, reason: 'token_reuse' },
                now,
              ),
            ])
          }
        }
        return null
      }

      const user = await this.users.findById(old.userId)
      if (!user) return null
      const session = await this.sessions.issue({
        userId: user.id,
        familyId: old.familyId,
        tokenId: nextTokenId,
        meta: cmd.meta,
      })
      return { user: { id: user.id, email: user.email.value }, session }
    })

    if (result === 'rotated')
      throw new UnauthorizedError(
        'refresh_token_rotated',
        'The session was just refreshed by another tab, retry with the current cookie',
      )
    if (!result)
      throw new UnauthorizedError('invalid_refresh_token', 'Session expired, please sign in again')
    return result
  }
}
