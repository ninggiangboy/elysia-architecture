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
   * Serialises everyone folding into this user's `groupKey` until the surrounding transaction ends: take it BEFORE
   * `coalesce`, so two events racing on a group with no row yet cannot both find nothing and both insert.
   * Only meaningful inside a transaction (the lock is released with it).
   */
  lockGroup(userId: string, groupKey: string): Promise<void>
  /**
   * Folds a new event into the user's latest UNREAD notification with the same `groupKey` created at or after `since`:
   * `count` + 1, the content replaced by the newest and `notifiedAt` = `now`. Returns it, or `null` when there is none.
   */
  coalesce(
    userId: string,
    groupKey: string,
    since: Date,
    now: Date,
    latest: Pick<NotificationProps, 'template' | 'title' | 'body' | 'data'>,
  ): Promise<Notification | null>
  /** `createdAt` of the user's newest notification older than `id` (ids are time-ordered), `null` if there is none. */
  createdAtBefore(userId: string, id: string): Promise<Date | null>
  /** Newest first. */
  list(query: ListQuery): Promise<Notification[]>
  countUnread(userId: string): Promise<number>
  /** Unread notifications that made news (`notifiedAt`) after the user last opened the list: the badge. */
  countUnseen(userId: string): Promise<number>
  /** When the user last opened the list, `null` if never. */
  lastSeenAt(userId: string): Promise<Date | null>
  /** The user has now seen everything up to `now`. Never moves backwards. */
  markSeen(userId: string, now: Date): Promise<void>
  /**
   * Marks one notification read. Scoped by `userId`, so a user can never touch another's.
   * `not_found` = no such notification for this user; `already_read` = nothing changed.
   */
  markRead(userId: string, id: string, now: Date): Promise<'marked' | 'already_read' | 'not_found'>
  /** Marks every unread notification of the user read; returns how many changed. */
  markAllRead(userId: string, now: Date): Promise<number>
  /** Retention: deletes up to `limit` notifications created before `cutoff`, read or not; returns how many went. */
  deleteCreatedBefore(cutoff: Date, limit: number): Promise<number>
}
