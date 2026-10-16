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
    // Write the correlation into headers so async handler logs can be traced back to the original request.
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
