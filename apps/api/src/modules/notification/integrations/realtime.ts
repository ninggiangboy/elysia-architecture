import { type RealtimeIntegration, realtimeRoute } from '#/modules/realtime/contracts'
import {
  type NotificationCreatedPayload,
  NotificationEvents,
  type NotificationReadPayload,
  type NotificationSeenPayload,
} from '../contracts'

export const notificationRealtime = {
  routes: [
    realtimeRoute<NotificationCreatedPayload>({
      name: 'realtime.push-notification-created',
      eventType: NotificationEvents.Created,
      map: (p) => ({
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
    }),
    realtimeRoute<NotificationReadPayload>({
      name: 'realtime.push-notification-read',
      eventType: NotificationEvents.Read,
      map: (p) => ({
        userId: p.userId,
        event: { type: 'notification.read', data: { id: p.notificationId, readAt: p.readAt } },
      }),
    }),
    realtimeRoute<NotificationSeenPayload>({
      name: 'realtime.push-notification-seen',
      eventType: NotificationEvents.Seen,
      map: (p) => ({
        userId: p.userId,
        event: { type: 'notification.seen', data: { seenAt: p.seenAt } },
      }),
    }),
  ],
} satisfies RealtimeIntegration
