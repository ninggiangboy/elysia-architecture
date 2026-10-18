/**
 * Event recorded by an aggregate. `type` is versioned (e.g. `identity.user_registered.v1`);
 * `payload` must be JSON-serializable and carry enough information so consumers never have to call back.
 */
export interface DomainEvent {
  readonly type: string
  readonly aggregateId: string
  readonly payload: Record<string, unknown>
  readonly occurredAt: Date
}
