import { and, eq } from 'drizzle-orm'
import type { InboxGuard } from '#/shared/application/ports'
import type { Database } from '#/shared/infrastructure/db/database'
import type { InboxTable } from './tables'

export class DrizzleInboxGuard implements InboxGuard {
  constructor(
    private database: Database,
    private table: InboxTable,
  ) {}

  /**
   * Side effect inside the module's DB: writes the inbox and runs `fn` in the SAME transaction
   * → effectively exactly-once. `fn` can use the module's repositories as usual.
   */
  async transactional(messageId: string, handler: string, fn: () => Promise<void>): Promise<void> {
    await this.database.run(async () => {
      const inserted = await this.database.executor
        .insert(this.table)
        .values({ messageId, handler })
        .onConflictDoNothing()
        .returning({ messageId: this.table.messageId })
      if (inserted.length === 0) return // already processed
      await fn()
    })
  }

  /**
   * External side effects (send mail, call HTTP) cannot be rolled back: run first, then write the inbox
   * → at-least-once; duplicates only if the process dies exactly between the two steps.
   */
  async afterSideEffect(
    messageId: string,
    handler: string,
    fn: () => Promise<void>,
  ): Promise<void> {
    const done = await this.database.executor
      .select({ messageId: this.table.messageId })
      .from(this.table)
      .where(and(eq(this.table.messageId, messageId), eq(this.table.handler, handler)))
      .limit(1)
    if (done.length > 0) return
    await fn()
    await this.database.executor
      .insert(this.table)
      .values({ messageId, handler })
      .onConflictDoNothing()
  }
}
