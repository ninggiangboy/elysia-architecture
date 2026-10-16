import type { IntegrationEventHandler, MessagePublisher } from '#/shared/application/ports'
import type { Logger } from '#/shared/infrastructure/logger'
import type { Envelope } from './envelope'

/**
 * Transport mặc định: gọi handler ngay trong process. Lỗi của từng handler được cô lập:
 * các handler còn lại vẫn chạy, sau đó `publish` ném lỗi để relay retry (handler đã xong sẽ bị inbox chặn).
 * Khi chuyển sang broker, mỗi (module, handler.name) tương ứng một consumer group.
 */
export class InProcessMessageBus implements MessagePublisher {
  private handlers = new Map<string, IntegrationEventHandler[]>()

  constructor(private logger: Logger) {}

  subscribe(handler: IntegrationEventHandler): void {
    const list = this.handlers.get(handler.eventType) ?? []
    list.push(handler)
    this.handlers.set(handler.eventType, list)
  }

  async publish(message: Envelope): Promise<void> {
    const handlers = this.handlers.get(message.type) ?? []
    const results = await Promise.allSettled(handlers.map((h) => h.handle(message)))
    const errors: unknown[] = []
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        errors.push(result.reason)
        this.logger.error(
          {
            err: result.reason,
            handler: handlers[i]?.name,
            messageId: message.id,
            type: message.type,
          },
          'event handler failed',
        )
      }
    })
    if (errors.length > 0) {
      throw new AggregateError(errors, `${errors.length} handler(s) failed for ${message.type}`)
    }
  }
}
