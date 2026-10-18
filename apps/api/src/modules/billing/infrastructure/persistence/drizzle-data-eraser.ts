import type { Database } from '@kit/db'
import { erasePublishedOutbox } from '@kit/messaging'
import type { DataEraser } from '@kit/privacy-participant'
import { eq } from 'drizzle-orm'
import { documents, ledgerEntries, outbox, topUps, walletBalances } from './schema'

/**
 * Takes the person out of the money records and keeps the records: top-ups, ledger entries and documents stay (a payment
 * is a financial document with its own retention rules) but lose their `user_id`, so nothing points back to the account.
 * The buyer written on a document (name, email, company, tax id) goes too: the number, the amount and the seller remain.
 * The wallet balances, which only exist for the person, are deleted.
 */
export class DrizzleBillingDataEraser implements DataEraser {
  constructor(private database: Database) {}

  async erase(userId: string): Promise<void> {
    const db = this.database.executor
    await db.update(topUps).set({ userId: null }).where(eq(topUps.userId, userId))
    await db.update(ledgerEntries).set({ userId: null }).where(eq(ledgerEntries.userId, userId))
    await db
      .update(documents)
      .set({ userId: null, buyer: { name: null, email: null, address: null, taxId: null } })
      .where(eq(documents.userId, userId))
    await db.delete(walletBalances).where(eq(walletBalances.userId, userId))
    await erasePublishedOutbox(this.database, outbox, userId)
  }
}
