import type { RealtimeIntegration } from '@mod/realtime/contracts'
import {
  type NotificationCreatedPayload,
  NotificationEvents,
  type NotificationReadPayload,
  type NotificationSeenPayload,
} from '../contracts'

export const notificationRealtime = {
  routes: [
    {
      name: 'realtime.push-notification-created',
      eventType: NotificationEvents.Created,
      map: (p: NotificationCreatedPayload) => ({
        userId: p.userId,
        event: {
          type: 'notification.created',
          data: {
            id: p.notificationId,
            kind: p.kind,
            template: p.template,
            title: p.title,
            body: p.body,
            data: p.data,
            createdAt: p.createdAt,
            count: p.count ?? 1,
          },
        },
      }),
    },
    {
      name: 'realtime.push-notification-read',
      eventType: NotificationEvents.Read,
      map: (p: NotificationReadPayload) => ({
        userId: p.userId,
        event: { type: 'notification.read', data: { id: p.notificationId, readAt: p.readAt } },
      }),
    },
    {
      name: 'realtime.push-notification-seen',
      eventType: NotificationEvents.Seen,
      map: (p: NotificationSeenPayload) => ({
        userId: p.userId,
        event: { type: 'notification.seen', data: { seenAt: p.seenAt } },
      }),
    },
  ],
} satisfies RealtimeIntegration
