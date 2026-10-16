export interface MessageHeaders {
  correlationId?: string
  causationId?: string
  traceparent?: string
}

/** JSON envelope of an integration event — the "on the wire" format, independent of transport. */
export interface Envelope<TPayload = Record<string, unknown>> {
  id: string
  type: string
  /** Name of the module that emitted the event. */
  source: string
  aggregateId: string
  occurredAt: string
  payload: TPayload
  headers: MessageHeaders
}
