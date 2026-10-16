import { IdentityEvents, type SessionRevokedPayload } from '#/modules/identity/contracts'
import type { IntegrationEventHandler } from '#/shared/application/ports'
import type { Envelope } from '#/shared/messaging/envelope'
import type { PushSubscriptionRepository } from '../../domain/push-subscription-repository'

/**
 * A signed-out device must stop receiving the account's notifications: logout, "sign out that device" and detected
 * token theft all revoke the session, and this drops the Web Push subscription that session registered.
 * A plain delete is idempotent, so no inbox is needed.
 */
export class DropPushSubscriptionsHandler implements IntegrationEventHandler {
  readonly name = 'notification.drop-push-on-session-revoked'
  readonly eventType = IdentityEvents.SessionRevoked

  constructor(private subscriptions: PushSubscriptionRepository) {}

  async handle(message: Envelope): Promise<void> {
    const p = message.payload as unknown as SessionRevokedPayload
    await this.subscriptions.deleteBySession(p.userId, p.sessionId)
  }
}
