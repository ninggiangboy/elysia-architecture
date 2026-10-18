import type { Clock, IdGenerator, UnitOfWork } from '#/shared/core'
import { MAX_SUBSCRIPTIONS_PER_USER, PushSubscription } from '../../domain/push-subscription'
import type { PushSubscriptionRepository } from '../../domain/push-subscription-repository'

/** Idempotent: the browser re-sends its subscription whenever the keys or the account change. */
export class SubscribeToPush {
  constructor(
    private subscriptions: PushSubscriptionRepository,
    private uow: UnitOfWork,
    private ids: IdGenerator,
    private clock: Clock,
  ) {}

  async execute(cmd: {
    userId: string
    sessionId: string
    endpoint: string
    p256dh: string
    auth: string
    userAgent: string | null
  }): Promise<void> {
    const subscription = PushSubscription.create({
      id: this.ids.next(),
      userId: cmd.userId,
      sessionId: cmd.sessionId,
      endpoint: cmd.endpoint,
      p256dh: cmd.p256dh,
      auth: cmd.auth,
      userAgent: cmd.userAgent?.slice(0, 300) ?? null,
      createdAt: this.clock.now(),
    })
    await this.uow.run(async () => {
      await this.subscriptions.upsert(subscription)
      await this.subscriptions.pruneOldest(cmd.userId, MAX_SUBSCRIPTIONS_PER_USER)
    })
  }
}

/** Idempotent: removing an unknown endpoint succeeds. */
export class UnsubscribeFromPush {
  constructor(private subscriptions: PushSubscriptionRepository) {}

  async execute(cmd: { userId: string; endpoint: string }): Promise<void> {
    await this.subscriptions.deleteByEndpoint(cmd.userId, cmd.endpoint)
  }
}
