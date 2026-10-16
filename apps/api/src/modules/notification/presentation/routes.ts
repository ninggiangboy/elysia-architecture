import { Elysia, t } from 'elysia'
import { NotFoundError } from '#/shared/application/errors'
import { authPlugin, type TokenVerifier } from '#/shared/http/auth.plugin'
import { userAgent } from '#/shared/http/client-info'
import { errorResponse, validationError } from '#/shared/http/openapi'
import type {
  MarkAllNotificationsRead,
  MarkNotificationRead,
  MarkNotificationsSeen,
} from '../application/use-cases/mark-read'
import type {
  SubscribeToPush,
  UnsubscribeFromPush,
} from '../application/use-cases/push-subscriptions'
import {
  DEFAULT_PAGE_SIZE,
  type GetUnreadCount,
  type GetUnseenCount,
  type ListNotifications,
  MAX_PAGE_SIZE,
} from '../application/use-cases/read-notifications'

export interface NotificationRouteDeps {
  verifier: TokenVerifier
  useCases: {
    listNotifications: ListNotifications
    getUnreadCount: GetUnreadCount
    getUnseenCount: GetUnseenCount
    markSeen: MarkNotificationsSeen
    markRead: MarkNotificationRead
    markAllRead: MarkAllNotificationsRead
    subscribeToPush: SubscribeToPush
    unsubscribeFromPush: UnsubscribeFromPush
  }
  /** VAPID public key the browser subscribes with; `null` = Web Push is not configured on this deployment. */
  webPushPublicKey: string | null
}

const pushSubscriptionBody = t.Object({
  endpoint: t.String({ minLength: 1, maxLength: 2048, description: '`PushSubscription.endpoint`' }),
  keys: t.Object({
    p256dh: t.String({ minLength: 1, maxLength: 256 }),
    auth: t.String({ minLength: 1, maxLength: 256 }),
  }),
})

const notificationBody = t.Object({
  id: t.String({ format: 'uuid' }),
  kind: t.String({
    description: 'Machine-readable category, e.g. `welcome`, `email_changed`, `security_alert`',
  }),
  title: t.String(),
  body: t.String(),
  data: t.Record(t.String(), t.Unknown(), {
    description: 'Extra context for the client, e.g. `{ "link": "/" }`',
  }),
  read: t.Boolean(),
  count: t.Integer({
    minimum: 1,
    description: 'How many events this stands for (repeats are folded while unread)',
  }),
  createdAt: t.String({ format: 'date-time' }),
  readAt: t.Nullable(t.String({ format: 'date-time' })),
})

export const notificationRoutes = ({
  verifier,
  useCases: uc,
  webPushPublicKey,
}: NotificationRouteDeps) =>
  new Elysia({ prefix: '/notifications', tags: ['notifications'] })
    .use(authPlugin(verifier))
    .get(
      '/',
      ({ auth, query }) =>
        uc.listNotifications.execute({
          userId: auth.userId,
          before: query.before,
          limit: query.limit,
          unreadOnly: query.unread,
        }),
      {
        auth: true,
        query: t.Object({
          limit: t.Optional(
            t.Integer({
              minimum: 1,
              maximum: MAX_PAGE_SIZE,
              default: DEFAULT_PAGE_SIZE,
              description: 'Page size',
            }),
          ),
          before: t.Optional(
            t.String({
              format: 'uuid',
              description: '`nextCursor` of the previous page, to fetch older notifications',
            }),
          ),
          unread: t.Optional(t.Boolean({ description: 'Only unread notifications' })),
        }),
        detail: {
          summary: 'List my notifications',
          description: 'Newest first, paginated with a cursor.',
        },
        response: {
          200: t.Object(
            {
              items: t.Array(notificationBody),
              nextCursor: t.Nullable(t.String({ format: 'uuid' })),
            },
            { description: 'A page of notifications' },
          ),
          400: validationError(),
        },
      },
    )
    .get('/unread-count', ({ auth }) => uc.getUnreadCount.execute({ userId: auth.userId }), {
      auth: true,
      detail: {
        summary: 'Count my unread notifications',
        description:
          'Not yet marked read, whether or not the list was opened since. See `/unseen-count` for the badge.',
      },
      response: { 200: t.Object({ count: t.Integer({ minimum: 0 }) }) },
    })
    .get('/unseen-count', ({ auth }) => uc.getUnseenCount.execute({ userId: auth.userId }), {
      auth: true,
      detail: {
        summary: 'Count my unseen notifications',
        description:
          'For the badge: unread notifications that arrived (or repeated) since the list was last opened with `POST /seen`.',
      },
      response: { 200: t.Object({ count: t.Integer({ minimum: 0 }) }) },
    })
    .post(
      '/seen',
      async ({ auth, set }) => {
        await uc.markSeen.execute({ userId: auth.userId })
        set.status = 204
      },
      {
        auth: true,
        detail: {
          summary: 'Mark the notification list as opened',
          description:
            'Resets the badge to zero without marking anything read. Idempotent; the next new notification counts again.',
        },
        response: { 204: t.Void({ description: 'Done' }) },
      },
    )
    .post('/read-all', ({ auth }) => uc.markAllRead.execute({ userId: auth.userId }), {
      auth: true,
      detail: { summary: 'Mark all my notifications read' },
      response: {
        200: t.Object(
          { updated: t.Integer({ minimum: 0, description: 'How many were unread before' }) },
          { description: 'Done' },
        ),
      },
    })
    .get('/push/public-key', () => ({ publicKey: webPushPublicKey }), {
      detail: {
        summary: 'Web Push public key',
        description:
          'The VAPID application server key for `pushManager.subscribe`. `null` when Web Push is not configured.',
      },
      response: { 200: t.Object({ publicKey: t.Nullable(t.String()) }) },
    })
    .put(
      '/push/subscription',
      async ({ auth, body, request, set }) => {
        if (!webPushPublicKey)
          throw new NotFoundError('web_push_disabled', 'Web Push is not enabled')
        await uc.subscribeToPush.execute({
          userId: auth.userId,
          sessionId: auth.sessionId,
          endpoint: body.endpoint,
          p256dh: body.keys.p256dh,
          auth: body.keys.auth,
          userAgent: userAgent(request),
        })
        set.status = 204
      },
      {
        auth: true,
        body: pushSubscriptionBody,
        detail: {
          summary: 'Register this browser for Web Push',
          description:
            'Idempotent. A browser that was registered by another account is moved to this one. The subscription ends with the login session that created it. At most 10 browsers per user: the oldest are dropped.',
        },
        response: {
          204: t.Void({ description: 'Registered' }),
          400: validationError(),
          404: errorResponse(404, 'web_push_disabled'),
        },
      },
    )
    .delete(
      '/push/subscription',
      async ({ auth, body, set }) => {
        await uc.unsubscribeFromPush.execute({ userId: auth.userId, endpoint: body.endpoint })
        set.status = 204
      },
      {
        auth: true,
        body: t.Object({ endpoint: t.String({ minLength: 1, maxLength: 2048 }) }),
        detail: {
          summary: 'Stop Web Push for this browser',
          description: 'Idempotent: an unknown endpoint also returns 204.',
        },
        response: { 204: t.Void({ description: 'Removed' }), 400: validationError() },
      },
    )
    .post(
      '/:id/read',
      async ({ auth, params, set }) => {
        await uc.markRead.execute({ userId: auth.userId, notificationId: params.id })
        set.status = 204
      },
      {
        auth: true,
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        detail: {
          summary: 'Mark one notification read',
          description: 'Idempotent: marking an already-read notification also returns 204.',
        },
        response: {
          204: t.Void({ description: 'Marked read' }),
          400: validationError(),
          404: errorResponse(404, 'notification_not_found'),
        },
      },
    )
