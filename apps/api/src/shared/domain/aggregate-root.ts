import type { DomainEvent } from './domain-event'

export abstract class AggregateRoot {
  private pendingEvents: DomainEvent[] = []

  /** `version` = phiên bản đã lưu trong DB (0 = chưa persist). Repository dùng cho optimistic locking. */
  constructor(
    readonly id: string,
    public version: number,
  ) {}

  protected record(type: string, payload: Record<string, unknown>, occurredAt: Date): void {
    this.pendingEvents.push({ type, aggregateId: this.id, payload, occurredAt })
  }

  pullEvents(): DomainEvent[] {
    const events = this.pendingEvents
    this.pendingEvents = []
    return events
  }
}
