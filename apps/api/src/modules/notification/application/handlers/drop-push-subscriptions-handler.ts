import type { IntegrationEventHandler } from '#/shared/application/ports'
import type { Envelope } from '#/shared/messaging/envelope'
import type { DropPushOn } from '../../contracts'
import type { PushSubscriptionRepository } from '../../domain/push-subscription-repository'

/**
 * A signed-out device must stop receiving the account's notifications: when a producer says a session ended (logout,
 * "sign out that device", detected token theft), this drops the Web Push subscription that session registered.
 * A plain delete is idempotent, so no inbox is needed.
 */
export class DropPushSubscriptionsHandler<TPayload> implements IntegrationEventHandler {
  readonly name: string
  readonly eventType: string

  constructor(
    private rule: DropPushOn<TPayload>,
    private subscriptions: PushSubscriptionRepository,
  ) {
    this.name = rule.name
    this.eventType = rule.eventType
  }

  async handle(message: Envelope): Promise<void> {
    const { userId, sessionId } = this.rule.session(message.payload as unknown as TPayload)
    await this.subscriptions.deleteBySession(userId, sessionId)
  }
}
