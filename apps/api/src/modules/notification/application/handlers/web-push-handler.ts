import type { Clock, InboxGuard, IntegrationEventHandler, Log } from '#/shared/application/ports'
import type { Envelope } from '#/shared/messaging/envelope'
import { type NotificationCreatedPayload, NotificationEvents } from '../../contracts'
import type { NotificationRepository } from '../../domain/notification-repository'
import type { PushSubscriptionRepository } from '../../domain/push-subscription-repository'
import type { WebPushSender } from '../ports'

/** A push that arrives hours late (relay backlog) is noise; the in-app inbox still has the notification. */
export const MAX_WEB_PUSH_AGE_MS = 15 * 60_000

const DEFAULT_LINK = '/'

/** Kinds that always get a push, however many notifications came just before (account security must not be muted). */
const ALWAYS_PUSH_KINDS: ReadonlySet<string> = new Set(['security_alert'])

/**
 * `notification.created` → Web Push to every browser the user subscribed.
 *  - `gone` subscriptions are deleted; `rejected` ones only lose this message.
 *  - `retry` rethrows so the relay retries the whole message. Browsers that already got it just replace the
 *    notification (same `tag`), so a retry never shows a duplicate.
 * The inbox runs the fan-out at most once per message once it succeeded.
 *
 * Quiet window: time is cut into fixed `quietWindowMs` buckets and only the FIRST notification of a user in a bucket
 * is pushed, so a burst of 100 events buzzes the phone once, not 100 times. Every notification is still stored and
 * counted in the in-app inbox. The decision is a pure function of stored data (the previous notification), so a retry
 * or redelivery reaches the same verdict. `0` disables it.
 */
export class WebPushHandler implements IntegrationEventHandler {
  readonly name = 'notification.web-push'
  readonly eventType = NotificationEvents.Created

  constructor(
    private subscriptions: PushSubscriptionRepository,
    private notifications: NotificationRepository,
    private sender: WebPushSender,
    private inbox: InboxGuard,
    private clock: Clock,
    private log: Log,
    private quietWindowMs = 0,
  ) {}

  async handle(message: Envelope): Promise<void> {
    if (this.clock.now().getTime() - Date.parse(message.occurredAt) > MAX_WEB_PUSH_AGE_MS) return
    const p = message.payload as unknown as NotificationCreatedPayload
    if (await this.isInQuietWindow(p)) return
    const link =
      typeof p.data.link === 'string' && p.data.link.startsWith('/') ? p.data.link : DEFAULT_LINK

    await this.inbox.afterSideEffect(message.id, this.name, async () => {
      const targets = await this.subscriptions.listByUser(p.userId)
      const outcomes = await Promise.all(
        targets.map(async (s) => ({
          subscription: s,
          outcome: await this.sender.send(
            { endpoint: s.endpoint, p256dh: s.props.p256dh, auth: s.props.auth },
            { id: p.notificationId, title: p.title, body: p.body, link },
          ),
        })),
      )
      for (const { subscription, outcome } of outcomes) {
        if (outcome === 'gone') await this.subscriptions.deleteById(subscription.id)
        else if (outcome === 'rejected')
          this.log.warn(
            { messageId: message.id, subscriptionId: subscription.id },
            'web push rejected by the push service, dropping',
          )
      }
      if (outcomes.some((o) => o.outcome === 'retry'))
        throw new Error('web push deferred: push service unavailable')
    })
  }

  private async isInQuietWindow(p: NotificationCreatedPayload): Promise<boolean> {
    if (this.quietWindowMs <= 0 || ALWAYS_PUSH_KINDS.has(p.kind)) return false
    const previous = await this.notifications.createdAtBefore(p.userId, p.notificationId)
    if (!previous) return false
    const bucketStart =
      Math.floor(Date.parse(p.createdAt) / this.quietWindowMs) * this.quietWindowMs
    return previous.getTime() >= bucketStart
  }
}
