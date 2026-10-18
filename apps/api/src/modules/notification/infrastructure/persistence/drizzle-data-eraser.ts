import type { Database } from '@kit/db'
import { erasePublishedOutbox } from '@kit/messaging'
import type { DataEraser } from '@kit/privacy-participant'
import { eq } from 'drizzle-orm'
import { inboxState, notifications, outbox, pushSubscriptions } from './schema'

/** Removes the user's notifications, their read marker and their push subscriptions (a subscription is a way to reach the person). */
export class DrizzleNotificationDataEraser implements DataEraser {
  constructor(private database: Database) {}

  async erase(userId: string): Promise<void> {
    const db = this.database.executor
    await db.delete(notifications).where(eq(notifications.userId, userId))
    await db.delete(inboxState).where(eq(inboxState.userId, userId))
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId))
    await erasePublishedOutbox(this.database, outbox, userId)
  }
}
