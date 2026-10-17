import type { DomainEvent } from '#/shared/domain/domain-event'
import type { Envelope } from '#/shared/messaging/envelope'

export interface Clock {
  now(): Date
}

export interface IdGenerator {
  next(): string
}

/**
 * A transaction. All modules share one pool, so it CAN span modules, but by convention it stays within one module:
 * that is what lets a module move to its own database later without rewriting its use cases.
 */
export interface UnitOfWork {
  run<T>(fn: () => Promise<T>): Promise<T>
}

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

export interface Mailer {
  send(mail: { to: string; subject: string; text: string; html: string }): Promise<void>
}

export interface ObjectStat {
  size: number
  contentType: string
}

export interface ObjectStorage {
  presignPut(key: string, opts: { contentType: string; expiresInSeconds: number }): string
  presignGet(key: string, expiresInSeconds: number): string
  stat(key: string): Promise<ObjectStat | null>
  /** The object's bytes, or `null` when it does not exist. */
  read(key: string): Promise<Uint8Array | null>
  /** Creates or overwrites the object. */
  write(key: string, data: Uint8Array, contentType: string): Promise<void>
  delete(key: string): Promise<void>
  /** Deletes every object whose key starts with `prefix`; returns how many. Idempotent: nothing to delete is fine. */
  deletePrefix(prefix: string): Promise<number>
}

/** Consumer-side deduplication (inbox pattern). Each (messageId, handler) takes effect only once. */
export interface InboxGuard {
  /** Side effect inside the module's DB: writes the inbox and runs `fn` in the same transaction. */
  transactional(messageId: string, handler: string, fn: () => Promise<void>): Promise<void>
  /** External side effect (send mail, delete file): runs first, then writes the inbox → at-least-once. */
  afterSideEffect(messageId: string, handler: string, fn: () => Promise<void>): Promise<void>
}

/** Minimal logger for the application layer (pino satisfies this shape). */
export interface Log {
  info(fields: object, message: string): void
  warn(fields: object, message: string): void
  error(fields: object, message: string): void
}
