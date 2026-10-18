import { requestContext } from '@kit/context'
import type { DomainEvent } from '@kit/core'
import type { Database } from '#/shared/db'
import { currentTraceparent } from '#/shared/telemetry'
import type { OutboxWriter } from '../ports'
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
    // Same for the trace: the relay continues from this span, which may run long after the request has ended.
    const traceparent = currentTraceparent()
    if (traceparent) headers.traceparent = traceparent
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
