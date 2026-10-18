import type { Database } from '@kit/db'
import { and, count, eq, gte, min, type SQL } from 'drizzle-orm'
import type { MagicLinkThrottle, ThrottleVerdict } from '../application/ports'
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

  async check(email: Email, ip: string, now: Date): Promise<ThrottleVerdict> {
    const since = new Date(now.getTime() - WINDOW_MS)
    const byEmail = await this.window(eq(magicLinks.email, email.value), since)
    if (byEmail.n >= this.limits.perEmail) return this.refused(byEmail.oldest, now)
    const byIp = await this.window(eq(magicLinks.requestedIp, ip), since)
    if (byIp.n >= this.limits.perIp) return this.refused(byIp.oldest, now)
    return { allowed: true }
  }

  private async window(scope: SQL, since: Date): Promise<{ n: number; oldest: Date | null }> {
    const [row] = await this.database.executor
      .select({ n: count(), oldest: min(magicLinks.createdAt) })
      .from(magicLinks)
      .where(and(scope, gte(magicLinks.createdAt, since)))
    return { n: row?.n ?? 0, oldest: row?.oldest ?? null }
  }

  /** A slot frees up when the oldest request still counted leaves the window. */
  private refused(oldest: Date | null, now: Date): ThrottleVerdict {
    const freesAt = (oldest?.getTime() ?? now.getTime()) + WINDOW_MS
    return { allowed: false, retryAfterMs: Math.max(1000, freesAt - now.getTime()) }
  }
}
