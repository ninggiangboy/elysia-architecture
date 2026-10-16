import type { IntegrationEventHandler, MessagePublisher } from '#/shared/application/ports'
import type { Logger } from '#/shared/infrastructure/logger'
import type { Envelope } from './envelope'

/**
 * Default transport: calls handlers directly in-process. Each handler's errors are isolated:
 * the other handlers still run, then `publish` throws so the relay retries (handlers already done are blocked by the inbox).
 * When moving to a broker, each (module, handler.name) maps to one consumer group.
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
