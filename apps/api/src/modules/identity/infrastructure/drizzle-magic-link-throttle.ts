import { and, count, eq, gte } from 'drizzle-orm'
import type { ModuleDatabase } from '#/shared/infrastructure/db/module-database'
import type { MagicLinkThrottle } from '../application/ports'
import type { Email } from '../domain/email'
import { magicLinks } from './persistence/schema'

const WINDOW_MS = 15 * 60_000

/**
 * Rate limit dựa trên chính bảng magic_links (không cần Redis, đúng khi chạy nhiều instance).
 * Không chặn tuyệt đối khi có race — chấp nhận vượt vài request, mục tiêu là chống spam.
 */
export class DrizzleMagicLinkThrottle implements MagicLinkThrottle {
  constructor(
    private mod: ModuleDatabase,
    private limits: { perEmail: number; perIp: number },
  ) {}

  async isAllowed(email: Email, ip: string, now: Date): Promise<boolean> {
    const since = new Date(now.getTime() - WINDOW_MS)
    const [byEmail] = await this.mod.executor
      .select({ n: count() })
      .from(magicLinks)
      .where(and(eq(magicLinks.email, email.value), gte(magicLinks.createdAt, since)))
    if ((byEmail?.n ?? 0) >= this.limits.perEmail) return false

    const [byIp] = await this.mod.executor
      .select({ n: count() })
      .from(magicLinks)
      .where(and(eq(magicLinks.requestedIp, ip), gte(magicLinks.createdAt, since)))
    return (byIp?.n ?? 0) < this.limits.perIp
  }
}
