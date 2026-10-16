import { eq } from 'drizzle-orm'
import type { DataEraser } from '#/shared/application/privacy'
import type { Database } from '#/shared/infrastructure/db/database'
import { erasePublishedOutbox } from '#/shared/infrastructure/outbox/erase-published'
import { ledgerEntries, outbox, topUps, walletBalances } from './schema'

/**
 * Takes the person out of the money records and keeps the records: top-ups and ledger entries stay (a payment is a
 * financial document with its own retention rules) but lose their `user_id`, so nothing points back to the account.
 * The wallet balances, which only exist for the person, are deleted.
 */
export class DrizzleBillingDataEraser implements DataEraser {
  constructor(private database: Database) {}

  async erase(userId: string): Promise<void> {
    const db = this.database.executor
    await db.update(topUps).set({ userId: null }).where(eq(topUps.userId, userId))
    await db.update(ledgerEntries).set({ userId: null }).where(eq(ledgerEntries.userId, userId))
    await db.delete(walletBalances).where(eq(walletBalances.userId, userId))
    await erasePublishedOutbox(this.database, outbox, userId)
  }
}
