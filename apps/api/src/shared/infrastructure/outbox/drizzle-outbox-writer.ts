import type { OutboxWriter } from '#/shared/application/ports'
import type { DomainEvent } from '#/shared/domain/domain-event'
import type { Database } from '#/shared/infrastructure/db/database'
import { requestContext } from '#/shared/infrastructure/request-context'
import type { OutboxTable } from './tables'

export class DrizzleOutboxWriter implements OutboxWriter {
  constructor(
    private database: Database,
    private table: OutboxTable,
    private newId: () => string,
  ) {}

  async add(events: DomainEvent[]): Promise<void> {
    if (events.length === 0) return
    if (!this.database.inTransaction) {
      throw new Error(
        'OutboxWriter.add must be called inside UnitOfWork.run (transactional outbox)',
      )
    }
    // Ghi correlation vào header để log của handler bất đồng bộ nối được về request gốc.
    const ctx = requestContext.get()
    const headers: Record<string, string> = ctx
      ? { correlationId: ctx.correlationId, causationId: ctx.requestId }
      : {}
    await this.database.executor.insert(this.table).values(
      events.map((e) => ({
        id: this.newId(),
        type: e.type,
        aggregateId: e.aggregateId,
        payload: e.payload,
        headers,
        occurredAt: e.occurredAt,
      })),
    )
  }
}
