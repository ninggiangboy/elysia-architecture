import type { Clock, IntegrationEventHandler } from '#/shared/application/ports'
import type { Envelope } from '#/shared/messaging/envelope'
import type { RealtimePush } from '../../contracts'
import type { RealtimeGateway } from '../ports'

/** Events older than this are worthless as a live notification (the relay was down or backlogged): skip them. */
export const MAX_PUSH_AGE_MS = 60_000

/**
 * Generic handler: integration event → push to the user's live connections.
 * No inbox needed: a duplicate push is harmless (clients treat events as "something changed, refetch").
 * A failed publish rethrows so the relay retries.
 */
export class RealtimePushHandler<TPayload> implements IntegrationEventHandler {
  constructor(
    readonly name: string,
    readonly eventType: string,
    private build: (payload: TPayload) => RealtimePush | null,
    private gateway: RealtimeGateway,
    private clock: Clock,
  ) {}

  async handle(message: Envelope): Promise<void> {
    if (this.clock.now().getTime() - Date.parse(message.occurredAt) > MAX_PUSH_AGE_MS) return
    const push = this.build(message.payload as unknown as TPayload)
    if (!push) return
    const { userId, event, closeSessionId } = push
    await this.gateway.publish({ userId, closeSessionId }, event)
  }
}
