/**
 * Integration events emitted by notification. The payload is a public contract: only add fields (backward compatible);
 * breaking changes need a new version (`.v2`) emitted in parallel for a while.
 */
export const NotificationEvents = {
  Created: 'notification.created.v1',
  Read: 'notification.read.v1',
} as const

export interface NotificationCreatedPayload {
  notificationId: string
  userId: string
  kind: string
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
