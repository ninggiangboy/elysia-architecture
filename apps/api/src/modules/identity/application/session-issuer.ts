import type { Clock, IdGenerator } from '#/shared/application/ports'
import { RefreshToken } from '../domain/refresh-token'
import type { RefreshTokenRepository } from '../domain/repositories'
import type { TokenService } from './ports'

export interface SessionTokens {
  accessToken: string
  accessTokenExpiresIn: number
  refreshToken: string
  refreshTokenExpiresAt: Date
}

export interface SessionMeta {
  ip: string | null
  userAgent: string | null
}

/** Phát hành cặp access + refresh token. Gọi trong UnitOfWork của use case. */
export class SessionIssuer {
  constructor(
    private refreshTokens: RefreshTokenRepository,
    private tokens: TokenService,
    private ids: IdGenerator,
    private clock: Clock,
    private refreshTtlSeconds: number,
  ) {}

  /**
   * `familyId` = phiên đăng nhập. Đăng nhập mới → family mới; refresh → giữ family cũ và dùng `tokenId`
   * đã được ghi vào `replaced_by_id` của token trước.
   */
  async issue(params: {
    userId: string
    familyId?: string
    tokenId?: string
    meta: SessionMeta
  }): Promise<SessionTokens> {
    const now = this.clock.now()
    const familyId = params.familyId ?? this.ids.next()
    const opaque = this.tokens.newOpaqueToken()
    const expiresAt = new Date(now.getTime() + this.refreshTtlSeconds * 1000)

    await this.refreshTokens.add(
      new RefreshToken(
        params.tokenId ?? this.ids.next(),
        params.userId,
        familyId,
        opaque.hash,
        expiresAt,
        now,
        null,
        null,
        params.meta.userAgent,
        params.meta.ip,
      ),
    )
    const access = await this.tokens.signAccessToken({ userId: params.userId, sessionId: familyId })
    return {
      accessToken: access.token,
      accessTokenExpiresIn: access.expiresInSeconds,
      refreshToken: opaque.token,
      refreshTokenExpiresAt: expiresAt,
    }
  }
}
