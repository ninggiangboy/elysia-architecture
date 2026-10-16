import type { Notification, NotificationProps } from './notification'

export interface ListQuery {
  userId: string
  /** Return only notifications with id lower than this (ids are time-ordered UUIDv7 → newest first). */
  before?: string
  limit: number
  unreadOnly: boolean
}

export interface NotificationRepository {
  insert(notification: Notification): Promise<void>
  /**
   * Folds a new event into the user's latest UNREAD notification with the same `groupKey` created at or after `since`:
   * `count` + 1, the content replaced by the newest and `notifiedAt` = `now`. Returns it, or `null` when there is none.
   */
  coalesce(
    userId: string,
    groupKey: string,
    since: Date,
    now: Date,
    latest: Pick<NotificationProps, 'title' | 'body' | 'data'>,
  ): Promise<Notification | null>
  /** `createdAt` of the user's newest notification older than `id` (ids are time-ordered), `null` if there is none. */
  createdAtBefore(userId: string, id: string): Promise<Date | null>
  /** Newest first. */
  list(query: ListQuery): Promise<Notification[]>
  countUnread(userId: string): Promise<number>
  /** Unread notifications that made news (`notifiedAt`) after the user last opened the list: the badge. */
  countUnseen(userId: string): Promise<number>
  /** The user has now seen everything up to `now`. Never moves backwards. */
  markSeen(userId: string, now: Date): Promise<void>
  /**
   * Marks one notification read. Scoped by `userId`, so a user can never touch another's.
   * `not_found` = no such notification for this user; `already_read` = nothing changed.
   */
  markRead(userId: string, id: string, now: Date): Promise<'marked' | 'already_read' | 'not_found'>
  /** Marks every unread notification of the user read; returns how many changed. */
  markAllRead(userId: string, now: Date): Promise<number>
}
