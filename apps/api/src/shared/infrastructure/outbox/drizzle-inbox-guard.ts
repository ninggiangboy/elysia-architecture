import { and, eq } from 'drizzle-orm'
import type { InboxGuard } from '#/shared/application/ports'
import type { ModuleDatabase } from '#/shared/infrastructure/db/module-database'
import type { InboxTable } from './tables'

export class DrizzleInboxGuard implements InboxGuard {
  constructor(
    private mod: ModuleDatabase,
    private table: InboxTable,
  ) {}

  /**
   * Side-effect nằm trong DB của module: ghi inbox và chạy `fn` trong CÙNG transaction
   * → exactly-once hiệu dụng. `fn` có thể dùng repository của module như bình thường.
   */
  async transactional(messageId: string, handler: string, fn: () => Promise<void>): Promise<void> {
    await this.mod.run(async () => {
      const inserted = await this.mod.executor
        .insert(this.table)
        .values({ messageId, handler })
        .onConflictDoNothing()
        .returning({ messageId: this.table.messageId })
      if (inserted.length === 0) return // đã xử lý
      await fn()
    })
  }

  /**
   * Side-effect ra ngoài (gửi mail, gọi HTTP) không rollback được: chạy rồi mới ghi inbox
   * → at-least-once; chỉ trùng lặp nếu process chết đúng giữa hai bước.
   */
  async afterSideEffect(
    messageId: string,
    handler: string,
    fn: () => Promise<void>,
  ): Promise<void> {
    const done = await this.mod.executor
      .select({ messageId: this.table.messageId })
      .from(this.table)
      .where(and(eq(this.table.messageId, messageId), eq(this.table.handler, handler)))
      .limit(1)
    if (done.length > 0) return
    await fn()
    await this.mod.executor.insert(this.table).values({ messageId, handler }).onConflictDoNothing()
  }
}
