import type { Clock, Log } from '#/shared/core'
import type { NotificationRepository } from '../domain/notification-repository'

export interface RetentionPolicy {
  /** Notifications older than this are deleted, read or not. */
  maxAgeMs: number
  /** Rows per delete, so one pass never holds a long lock or builds a huge transaction. */
  batchSize: number
}

/** Retention: the notification table must not grow forever. */
export class PruneOldNotifications {
  constructor(
    private notifications: NotificationRepository,
    private policy: RetentionPolicy,
    private clock: Clock,
    private log: Log,
  ) {}

  /** Deletes everything past the retention, one batch at a time; returns how many went. */
  async runOnce(): Promise<number> {
    const cutoff = new Date(this.clock.now().getTime() - this.policy.maxAgeMs)
    let total = 0
    for (;;) {
      const deleted = await this.notifications.deleteCreatedBefore(cutoff, this.policy.batchSize)
      total += deleted
      if (deleted < this.policy.batchSize) break
    }
    if (total > 0) this.log.info({ deleted: total, cutoff }, 'old notifications deleted')
    return total
  }
}
