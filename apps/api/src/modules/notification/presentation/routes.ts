import { Elysia, t } from 'elysia'
import { authPlugin, type TokenVerifier } from '#/shared/http/auth.plugin'
import { errorResponse, validationError } from '#/shared/http/openapi'
import type {
  MarkAllNotificationsRead,
  MarkNotificationRead,
} from '../application/use-cases/mark-read'
import {
  DEFAULT_PAGE_SIZE,
  type GetUnreadCount,
  type ListNotifications,
  MAX_PAGE_SIZE,
} from '../application/use-cases/read-notifications'

export interface NotificationRouteDeps {
  verifier: TokenVerifier
  useCases: {
    listNotifications: ListNotifications
    getUnreadCount: GetUnreadCount
    markRead: MarkNotificationRead
    markAllRead: MarkAllNotificationsRead
  }
}

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
  createdAt: t.String({ format: 'date-time' }),
  readAt: t.Nullable(t.String({ format: 'date-time' })),
})

export const notificationRoutes = ({ verifier, useCases: uc }: NotificationRouteDeps) =>
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
      detail: { summary: 'Count my unread notifications', description: 'For the badge.' },
      response: { 200: t.Object({ count: t.Integer({ minimum: 0 }) }) },
    })
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
