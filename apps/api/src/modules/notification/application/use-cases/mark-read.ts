import type { Clock, UnitOfWork } from '#/shared/core'
import { NotFoundError } from '#/shared/core'
import type { OutboxWriter } from '#/shared/messaging'
import type { NotificationRepository } from '../../domain/notification-repository'
import { notificationRead, notificationsSeen } from '../notification-events'

/**
 * Idempotent: marking an already-read notification succeeds and emits nothing.
 * The `notification.read` event lets the user's other open devices clear their badge.
 */
export class MarkNotificationRead {
  constructor(
    private notifications: NotificationRepository,
    private outbox: OutboxWriter,
    private uow: UnitOfWork,
    private clock: Clock,
  ) {}

  async execute(cmd: { userId: string; notificationId: string }): Promise<void> {
    const now = this.clock.now()
    const outcome = await this.uow.run(async () => {
      const result = await this.notifications.markRead(cmd.userId, cmd.notificationId, now)
      if (result === 'marked')
        await this.outbox.add([
          notificationRead({ userId: cmd.userId, notificationId: cmd.notificationId }, now),
        ])
      return result
    })
    if (outcome === 'not_found')
      throw new NotFoundError('notification_not_found', 'Notification not found')
  }
}

export class MarkAllNotificationsRead {
  constructor(
    private notifications: NotificationRepository,
    private outbox: OutboxWriter,
    private uow: UnitOfWork,
    private clock: Clock,
  ) {}

  async execute(cmd: { userId: string }): Promise<{ updated: number }> {
    const now = this.clock.now()
    const updated = await this.uow.run(async () => {
      const n = await this.notifications.markAllRead(cmd.userId, now)
      if (n > 0)
        await this.outbox.add([notificationRead({ userId: cmd.userId, notificationId: null }, now)])
      return n
    })
    return { updated }
  }
}

/**
 * The user opened the notification list: everything that made news so far no longer counts for the badge (the read
 * state of each notification is untouched). Idempotent; the `notification.seen` event, sent only when the badge was
 * showing something, lets the user's other open devices clear theirs.
 */
export class MarkNotificationsSeen {
  constructor(
    private notifications: NotificationRepository,
    private outbox: OutboxWriter,
    private uow: UnitOfWork,
    private clock: Clock,
  ) {}

  async execute(cmd: { userId: string }): Promise<void> {
    const now = this.clock.now()
    await this.uow.run(async () => {
      const unseen = await this.notifications.countUnseen(cmd.userId)
      await this.notifications.markSeen(cmd.userId, now)
      if (unseen > 0) await this.outbox.add([notificationsSeen({ userId: cmd.userId }, now)])
    })
  }
}
