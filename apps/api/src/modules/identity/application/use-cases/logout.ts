import type { Clock } from '#/shared/application/ports'
import type { RefreshTokenRepository } from '../../domain/repositories'

export class Logout {
  constructor(
    private refreshTokens: RefreshTokenRepository,
    private clock: Clock,
  ) {}

  /** Thu hồi cả family → mọi refresh token của phiên này vô hiệu. Access token tự hết hạn sau ≤ TTL. */
  async execute(cmd: { sessionId: string }): Promise<void> {
    await this.refreshTokens.revokeFamily(cmd.sessionId, this.clock.now())
  }
}
