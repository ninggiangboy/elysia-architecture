/**
 * Integration events emitted by notification. The payload is a public contract: only add fields (backward compatible);
 * breaking changes need a new version (`.v2`) emitted in parallel for a while.
 */
export const NotificationEvents = {
  Created: 'notification.created.v1',
  Read: 'notification.read.v1',
  Seen: 'notification.seen.v1',
  /** Answers to the privacy module's requests (see `privacy/contracts`). */
  DataExported: 'notification.data_exported.v1',
  UserDataErased: 'notification.user_data_erased.v1',
} as const

export interface NotificationCreatedPayload {
  notificationId: string
  userId: string
  kind: string
  /** The message template the client writes in the reader's language from `data`; absent/`null` = custom (`title`/`body`). */
  template?: string | null
  /** The text of a custom notification; empty when `template` is set. */
  title: string
  body: string
  data: Record<string, unknown>
  createdAt: string
  /** How many events the notification stands for; > 1 when repeats were folded into it. Absent in older events. */
  count?: number
}

export interface NotificationReadPayload {
  userId: string
  /** The notification that was marked read; `null` = every unread notification of the user. */
  notificationId: string | null
  readAt: string
}

export interface NotificationSeenPayload {
  userId: string
  seenAt: string
}
