export const REFRESH_REUSE_GRACE_MS = 10_000

/**
 * An (opaque) refresh token belongs to a "family" = one login session. Each refresh issues a new token in the same family
 * and revokes the old one; reusing a revoked token (outside the grace window) means it was stolen → revoke the whole family.
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

  /** Token rotated within a short window — usually two tabs refreshing at once, not theft. */
  isRecentlyRotated(now: Date): boolean {
    return (
      this.revokedAt !== null &&
      this.replacedById !== null &&
      now.getTime() - this.revokedAt.getTime() <= REFRESH_REUSE_GRACE_MS
    )
  }
}
