import type { DomainEvent } from '#/shared/domain/domain-event'
import {
  type NotificationCreatedPayload,
  NotificationEvents,
  type NotificationReadPayload,
} from '../contracts'
import type { Notification } from '../domain/notification'

export function notificationCreated(n: Notification): DomainEvent {
  const p = n.props
  const payload: NotificationCreatedPayload = {
    notificationId: p.id,
    userId: p.userId,
    kind: p.kind,
    title: p.title,
    body: p.body,
    data: p.data,
    createdAt: p.createdAt.toISOString(),
  }
  return {
    type: NotificationEvents.Created,
    aggregateId: p.userId,
    payload: { ...payload },
    occurredAt: p.createdAt,
  }
}

export function notificationRead(
  p: { userId: string; notificationId: string | null },
  now: Date,
): DomainEvent {
  const payload: NotificationReadPayload = { ...p, readAt: now.toISOString() }
  return {
    type: NotificationEvents.Read,
    aggregateId: p.userId,
    payload: { ...payload },
    occurredAt: now,
  }
}
