import type { DomainEvent } from '#/shared/core'
import type { Envelope } from './envelope'

/** Writes an event to the module's outbox table, inside the current transaction. */
export interface OutboxWriter {
  add(events: DomainEvent[]): Promise<void>
}

/** Outbound port of the relay. Currently an in-process bus; can be replaced by NATS/Kafka/RabbitMQ. */
export interface MessagePublisher {
  publish(message: Envelope): Promise<void>
}

/** Handler for an integration event. At-least-once: the handler MUST be idempotent (use InboxGuard). */
export interface IntegrationEventHandler {
  readonly name: string
  readonly eventType: string
  handle(message: Envelope): Promise<void>
}

/** Consumer-side deduplication (inbox pattern). Each (messageId, handler) takes effect only once. */
export interface InboxGuard {
  /** Side effect inside the module's DB: writes the inbox and runs `fn` in the same transaction. */
  transactional(messageId: string, handler: string, fn: () => Promise<void>): Promise<void>
  /** External side effect (send mail, delete file): runs first, then writes the inbox → at-least-once. */
  afterSideEffect(messageId: string, handler: string, fn: () => Promise<void>): Promise<void>
}
