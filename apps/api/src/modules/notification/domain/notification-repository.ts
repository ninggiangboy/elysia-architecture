import type { Notification } from './notification'

export interface ListQuery {
  userId: string
  /** Return only notifications with id lower than this (ids are time-ordered UUIDv7 → newest first). */
  before?: string
  limit: number
  unreadOnly: boolean
}

export interface NotificationRepository {
  insert(notification: Notification): Promise<void>
  /** Newest first. */
  list(query: ListQuery): Promise<Notification[]>
  countUnread(userId: string): Promise<number>
  /**
   * Marks one notification read. Scoped by `userId`, so a user can never touch another's.
   * `not_found` = no such notification for this user; `already_read` = nothing changed.
   */
  markRead(userId: string, id: string, now: Date): Promise<'marked' | 'already_read' | 'not_found'>
  /** Marks every unread notification of the user read; returns how many changed. */
  markAllRead(userId: string, now: Date): Promise<number>
}
