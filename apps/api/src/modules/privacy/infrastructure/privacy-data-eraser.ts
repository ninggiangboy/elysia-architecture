import { and, eq, inArray } from 'drizzle-orm'
import type { ObjectStorage } from '#/shared/application/ports'
import type { DataEraser } from '#/shared/application/privacy'
import type { Database } from '#/shared/infrastructure/db/database'
import { erasePublishedOutbox } from '#/shared/infrastructure/outbox/erase-published'
import { exportsPrefix } from '../application/keys'
import { accountDeletions, exportRequests, outbox } from './persistence/schema'

/**
 * Privacy is a participant in its own erasure: whatever it holds about the user goes too — the export archives, their
 * records, the addresses it kept to say goodbye. The deletion that is running keeps its row (it is the proof the erasure
 * happened, and holds the address for the last mail until the deletion completes).
 */
export class PrivacyDataEraser implements DataEraser {
  constructor(
    private database: Database,
    private storage: ObjectStorage,
  ) {}

  async erase(userId: string): Promise<void> {
    await this.storage.deletePrefix(exportsPrefix(userId))
    // Parts go with their export (ON DELETE CASCADE).
    await this.database.executor.delete(exportRequests).where(eq(exportRequests.userId, userId))
    await this.database.executor
      .update(accountDeletions)
      .set({ email: null })
      .where(
        and(
          eq(accountDeletions.userId, userId),
          inArray(accountDeletions.status, ['cancelled', 'completed']),
        ),
      )
    await erasePublishedOutbox(this.database, outbox, userId)
  }
}
