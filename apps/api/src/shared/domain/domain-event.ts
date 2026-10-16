/**
 * Sự kiện do aggregate ghi lại. `type` có version (vd. `identity.user_registered.v1`);
 * `payload` phải JSON-serializable và đủ thông tin để consumer không phải gọi ngược lại.
 */
export interface DomainEvent {
  readonly type: string
  readonly aggregateId: string
  readonly payload: Record<string, unknown>
  readonly occurredAt: Date
}
