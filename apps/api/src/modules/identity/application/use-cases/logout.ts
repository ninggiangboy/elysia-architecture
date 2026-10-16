import type { Clock } from '#/shared/application/ports'
import type { RefreshTokenRepository } from '../../domain/repositories'

export class Logout {
  constructor(
    private refreshTokens: RefreshTokenRepository,
    private clock: Clock,
  ) {}

  /** Revokes the whole family → every refresh token of this session is invalidated. The access token expires on its own within ≤ TTL. */
  async execute(cmd: { sessionId: string }): Promise<void> {
    await this.refreshTokens.revokeFamily(cmd.sessionId, this.clock.now())
  }
}
