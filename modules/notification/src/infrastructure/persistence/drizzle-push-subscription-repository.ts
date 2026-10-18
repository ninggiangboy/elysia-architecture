import type { Database } from '@kit/db'
import { and, desc, eq, notInArray } from 'drizzle-orm'
import { PushSubscription } from '../../domain/push-subscription'
import type { PushSubscriptionRepository } from '../../domain/push-subscription-repository'
import { pushSubscriptions } from './schema'

export class DrizzlePushSubscriptionRepository implements PushSubscriptionRepository {
  constructor(private database: Database) {}

  async upsert(subscription: PushSubscription): Promise<void> {
    const p = subscription.props
    await this.database.executor
      .insert(pushSubscriptions)
      .values(p)
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        // The row keeps its id but follows the account that is signed in on this browser now; `created_at`
        // becomes "last subscribed", so a browser in active use is never the one pruned as oldest.
        set: {
          userId: p.userId,
          sessionId: p.sessionId,
          p256dh: p.p256dh,
          auth: p.auth,
          userAgent: p.userAgent,
          createdAt: p.createdAt,
        },
      })
  }

  async listByUser(userId: string): Promise<PushSubscription[]> {
    const rows = await this.database.executor
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId))
      .orderBy(desc(pushSubscriptions.createdAt))
    return rows.map((row) => PushSubscription.restore(row))
  }

  async deleteByEndpoint(userId: string, endpoint: string): Promise<void> {
    await this.database.executor
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
  }

  async deleteBySession(userId: string, sessionId: string): Promise<void> {
    await this.database.executor
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.sessionId, sessionId)))
  }

  async deleteById(id: string): Promise<void> {
    await this.database.executor.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id))
  }

  async pruneOldest(userId: string, keep: number): Promise<void> {
    const ex = this.database.executor
    const newest = await ex
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId))
      .orderBy(desc(pushSubscriptions.createdAt), desc(pushSubscriptions.id))
      .limit(keep)
    if (newest.length < keep) return
    await ex.delete(pushSubscriptions).where(
      and(
        eq(pushSubscriptions.userId, userId),
        notInArray(
          pushSubscriptions.id,
          newest.map((r) => r.id),
        ),
      ),
    )
  }
}
