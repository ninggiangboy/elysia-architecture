import { and, count, eq, gte } from 'drizzle-orm'
import type { Database } from '#/shared/infrastructure/db/database'
import type { MagicLinkThrottle } from '../application/ports'
import type { Email } from '../domain/email'
import { magicLinks } from './persistence/schema'

const WINDOW_MS = 15 * 60_000

/**
 * Rate limit based on the magic_links table itself (no Redis needed, correct with multiple instances).
 * Not strictly enforced under races — a few extra requests may slip through; the goal is anti-spam.
 */
export class DrizzleMagicLinkThrottle implements MagicLinkThrottle {
  constructor(
    private database: Database,
    private limits: { perEmail: number; perIp: number },
  ) {}

  async isAllowed(email: Email, ip: string, now: Date): Promise<boolean> {
    const since = new Date(now.getTime() - WINDOW_MS)
    const [byEmail] = await this.database.executor
      .select({ n: count() })
      .from(magicLinks)
      .where(and(eq(magicLinks.email, email.value), gte(magicLinks.createdAt, since)))
    if ((byEmail?.n ?? 0) >= this.limits.perEmail) return false

    const [byIp] = await this.database.executor
      .select({ n: count() })
      .from(magicLinks)
      .where(and(eq(magicLinks.requestedIp, ip), gte(magicLinks.createdAt, since)))
    return (byIp?.n ?? 0) < this.limits.perIp
  }
}
