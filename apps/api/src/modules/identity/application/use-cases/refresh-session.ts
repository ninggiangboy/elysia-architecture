import { UnauthorizedError } from '#/shared/application/errors'
import type { Clock, IdGenerator, UnitOfWork } from '#/shared/application/ports'
import type { RefreshTokenRepository, UserRepository } from '../../domain/repositories'
import type { TokenService } from '../ports'
import type { SessionIssuer, SessionMeta } from '../session-issuer'
import type { VerifyMagicLinkResult } from './verify-magic-link'

export class RefreshSession {
  constructor(
    private refreshTokens: RefreshTokenRepository,
    private users: UserRepository,
    private sessions: SessionIssuer,
    private tokens: TokenService,
    private uow: UnitOfWork,
    private ids: IdGenerator,
    private clock: Clock,
  ) {}

  async execute(cmd: { refreshToken: string; meta: SessionMeta }): Promise<VerifyMagicLinkResult> {
    const now = this.clock.now()
    const hash = this.tokens.hashOpaqueToken(cmd.refreshToken)

    // Return null (instead of throwing) inside the transaction so the family revocation is COMMITTED before reporting the error.
    const result = await this.uow.run(async () => {
      const nextTokenId = this.ids.next()
      const old = await this.refreshTokens.consume(hash, nextTokenId, now)
      if (!old) {
        const known = await this.refreshTokens.findByHash(hash)
        // A rotated token that is used again → treat as stolen, revoke the whole session.
        if (known && !known.isRecentlyRotated(now)) {
          await this.refreshTokens.revokeFamily(known.familyId, now)
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

    if (!result)
      throw new UnauthorizedError('invalid_refresh_token', 'Session expired, please sign in again')
    return result
  }
}
