export interface MessageHeaders {
  correlationId?: string
  causationId?: string
  traceparent?: string
}

/** Phong bì JSON của integration event — định dạng "trên dây", độc lập transport. */
export interface Envelope<TPayload = Record<string, unknown>> {
  id: string
  type: string
  /** Tên module phát event. */
  source: string
  aggregateId: string
  occurredAt: string
  payload: TPayload
  headers: MessageHeaders
}
