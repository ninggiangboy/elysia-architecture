export const REFRESH_REUSE_GRACE_MS = 10_000

/**
 * Refresh token (opaque) thuộc một "family" = một phiên đăng nhập. Mỗi lần refresh sinh token mới cùng family,
 * token cũ bị thu hồi; dùng lại token đã thu hồi (ngoài khoảng grace) nghĩa là bị đánh cắp → thu hồi cả family.
 */
export class RefreshToken {
  constructor(
    readonly id: string,
    readonly userId: string,
    readonly familyId: string,
    readonly tokenHash: string,
    readonly expiresAt: Date,
    readonly createdAt: Date,
    readonly revokedAt: Date | null,
    readonly replacedById: string | null,
    readonly userAgent: string | null,
    readonly ip: string | null,
  ) {}

  /** Token vừa được xoay trong khoảng ngắn — thường là hai tab refresh đồng thời, không phải trộm. */
  isRecentlyRotated(now: Date): boolean {
    return (
      this.revokedAt !== null &&
      this.replacedById !== null &&
      now.getTime() - this.revokedAt.getTime() <= REFRESH_REUSE_GRACE_MS
    )
  }
}
