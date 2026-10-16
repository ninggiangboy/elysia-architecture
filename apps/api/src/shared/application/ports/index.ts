import type { DomainEvent } from '#/shared/domain/domain-event'
import type { Envelope } from '#/shared/messaging/envelope'

export interface Clock {
  now(): Date
}

export interface IdGenerator {
  next(): string
}

/** Transaction trong phạm vi MỘT module (một DB). Không có transaction xuyên module. */
export interface UnitOfWork {
  run<T>(fn: () => Promise<T>): Promise<T>
}

/** Ghi event vào bảng outbox của module, trong transaction hiện tại. */
export interface OutboxWriter {
  add(events: DomainEvent[]): Promise<void>
}

/** Cổng ra của relay. Hiện là in-process bus; có thể thay bằng NATS/Kafka/RabbitMQ. */
export interface MessagePublisher {
  publish(message: Envelope): Promise<void>
}

/** Handler cho integration event. At-least-once: handler PHẢI idempotent (dùng InboxGuard). */
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
  delete(key: string): Promise<void>
}

/** Khử trùng lặp phía consumer (inbox pattern). Mỗi (messageId, handler) chỉ có hiệu lực một lần. */
export interface InboxGuard {
  /** Side-effect nằm trong DB của module: ghi inbox + chạy `fn` cùng một transaction. */
  transactional(messageId: string, handler: string, fn: () => Promise<void>): Promise<void>
  /** Side-effect ra ngoài (gửi mail, xoá file): chạy rồi mới ghi inbox → at-least-once. */
  afterSideEffect(messageId: string, handler: string, fn: () => Promise<void>): Promise<void>
}

/** Logger tối thiểu cho tầng application (pino thoả mãn cấu trúc này). */
export interface Log {
  info(fields: object, message: string): void
  warn(fields: object, message: string): void
  error(fields: object, message: string): void
}
