import { eq } from 'drizzle-orm'
import type { ObjectStorage } from '#/shared/application/ports'
import type { DataEraser } from '#/shared/application/privacy'
import type { Database } from '#/shared/infrastructure/db/database'
import { erasePublishedOutbox } from '#/shared/infrastructure/outbox/erase-published'
import { outbox, profiles } from './schema'

/**
 * Removes the profile and every file under the user's folder — not only the current avatar and cover but also images
 * that were uploaded and never set, which the profile row knows nothing about.
 */
export class DrizzleProfileDataEraser implements DataEraser {
  constructor(
    private database: Database,
    private storage: ObjectStorage,
  ) {}

  async erase(userId: string): Promise<void> {
    // Files first: if this fails the row (and the keys in it) is still there for the retry.
    await this.storage.deletePrefix(`${userId}/`)
    await this.database.executor.delete(profiles).where(eq(profiles.userId, userId))
    await erasePublishedOutbox(this.database, outbox, userId)
  }
}
