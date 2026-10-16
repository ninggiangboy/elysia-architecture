import { NotFoundError } from '#/shared/application/errors'
import type { Clock, OutboxWriter, UnitOfWork } from '#/shared/application/ports'
import type { NotificationRepository } from '../../domain/notification-repository'
import { notificationRead } from '../notification-events'

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
