import type { Logger } from '#/shared/telemetry'
import { SpanKind, withSpan } from '#/shared/telemetry'
import type { Envelope } from './envelope'
import { RetryLaterError } from './errors'
import type { IntegrationEventHandler, MessagePublisher } from './ports'

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
    const results = await Promise.allSettled(
      handlers.map((h) =>
        withSpan(
          `handle ${h.name}`,
          {
            kind: SpanKind.CONSUMER,
            attributes: {
              'messaging.system': 'outbox',
              'messaging.message.id': message.id,
              'messaging.destination.name': message.type,
              'messaging.consumer.group.name': h.name,
            },
          },
          () => h.handle(message),
        ),
      ),
    )
    const errors: unknown[] = []
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        errors.push(result.reason)
        // A deferral (rate limit) is expected, not a failure: warn without the stack.
        if (result.reason instanceof RetryLaterError) {
          this.logger.warn(
            {
              handler: handlers[i]?.name,
              messageId: message.id,
              type: message.type,
              retryAfterMs: result.reason.retryAfterMs,
            },
            result.reason.message,
          )
          return
        }
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
