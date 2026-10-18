import { errorResponse } from '@kit/http'
import { Elysia, t } from 'elysia'
import { authPlugin, type TokenVerifier } from '#/shared/auth'
import type {
  CancelAccountDeletion,
  GetAccountDeletion,
  ScheduleAccountDeletion,
} from '../application/use-cases/account-deletion'
import type {
  GetDataExport,
  GetExportDownload,
  ListDataExports,
  RequestDataExport,
} from '../application/use-cases/data-export'

export interface PrivacyRouteDeps {
  verifier: TokenVerifier
  useCases: {
    requestDataExport: RequestDataExport
    listDataExports: ListDataExports
    getDataExport: GetDataExport
    getExportDownload: GetExportDownload
    scheduleAccountDeletion: ScheduleAccountDeletion
    cancelAccountDeletion: CancelAccountDeletion
    getAccountDeletion: GetAccountDeletion
  }
}

const progress = t.Object({ done: t.Integer(), total: t.Integer() })
const modules = t.Array(t.Object({ module: t.String(), done: t.Boolean() }), {
  description: 'Each module that contributes, and whether it has finished',
})

const exportBody = t.Object(
  {
    id: t.String({ format: 'uuid' }),
    status: t.Union(
      [
        t.Literal('collecting'),
        t.Literal('assembling'),
        t.Literal('ready'),
        t.Literal('failed'),
        t.Literal('expired'),
      ],
      { description: '`ready` exports can be downloaded until `expiresAt`' },
    ),
    requestedAt: t.String({ format: 'date-time' }),
    readyAt: t.Nullable(t.String({ format: 'date-time' })),
    expiresAt: t.Nullable(t.String({ format: 'date-time' })),
    size: t.Nullable(t.Integer({ description: 'Archive size in bytes' })),
    progress,
    modules,
  },
  { description: 'A request for a copy of your data' },
)

const deletionBody = t.Object(
  {
    id: t.String({ format: 'uuid' }),
    status: t.Union([t.Literal('scheduled'), t.Literal('running')], {
      description:
        '`scheduled`: waiting out the grace period, can be cancelled. `running`: being erased, can not be cancelled.',
    }),
    requestedAt: t.String({ format: 'date-time' }),
    scheduledFor: t.String({
      format: 'date-time',
      description: 'End of the grace period',
    }),
    startedAt: t.Nullable(t.String({ format: 'date-time' })),
    progress,
    modules,
  },
  { description: 'An account deletion that is scheduled or under way' },
)

export const privacyRoutes = ({ verifier, useCases: uc }: PrivacyRouteDeps) =>
  new Elysia({ prefix: '/privacy', tags: ['privacy'] })
    .use(authPlugin(verifier))
    .post(
      '/exports',
      ({ auth, set }) => {
        set.status = 202
        return uc.requestDataExport.execute({ userId: auth.userId, authTime: auth.authTime })
      },
      {
        auth: true,
        detail: {
          summary: 'Request a copy of my data',
          description:
            'Every part of the service prepares its share; they are zipped, and a download link is sent by e-mail and as a notification. Follow progress with `GET /privacy/exports/{id}` or the `privacy.export.*` realtime events. One export at a time.',
        },
        response: {
          202: exportBody,
          403: errorResponse(403, 'step_up_required'),
          404: errorResponse(404, 'user_not_found'),
          409: errorResponse(409, 'export_in_progress', 'account_being_deleted'),
        },
      },
    )
    .get('/exports', async ({ auth }) => ({ items: await uc.listDataExports.execute(auth) }), {
      auth: true,
      detail: { summary: 'My recent exports', description: 'Newest first, up to 10.' },
      response: { 200: t.Object({ items: t.Array(exportBody) }) },
    })
    .get(
      '/exports/:id',
      ({ auth, params }) => uc.getDataExport.execute({ userId: auth.userId, exportId: params.id }),
      {
        auth: true,
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        detail: { summary: 'One export, with its progress' },
        response: { 200: exportBody, 404: errorResponse(404, 'export_not_found') },
      },
    )
    .get(
      '/exports/:id/download',
      ({ auth, params }) =>
        uc.getExportDownload.execute({
          userId: auth.userId,
          exportId: params.id,
          authTime: auth.authTime,
        }),
      {
        auth: true,
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        detail: {
          summary: 'A short-lived download link for a ready export',
          description: 'The link is valid for 15 minutes; ask again for a new one.',
        },
        response: {
          200: t.Object({ url: t.String(), expiresAt: t.String({ format: 'date-time' }) }),
          403: errorResponse(403, 'step_up_required'),
          404: errorResponse(404, 'export_not_found'),
          409: errorResponse(409, 'export_not_ready'),
        },
      },
    )
    .get(
      '/deletion',
      async ({ auth }) => ({ deletion: await uc.getAccountDeletion.execute(auth) }),
      {
        auth: true,
        detail: {
          summary: 'My account deletion, if one is scheduled or under way',
          description:
            'Signing in during the grace period does not cancel the deletion; this is how a client finds out and offers to cancel.',
        },
        response: { 200: t.Object({ deletion: t.Nullable(deletionBody) }) },
      },
    )
    .post(
      '/deletion',
      ({ auth, set }) => {
        set.status = 202
        return uc.scheduleAccountDeletion.execute({
          userId: auth.userId,
          authTime: auth.authTime,
        })
      },
      {
        auth: true,
        detail: {
          summary: 'Delete my account',
          description:
            'Schedules the deletion. Nothing is erased until the grace period ends; until then it can be cancelled with `DELETE /privacy/deletion`. Afterwards every part of the service erases its data and confirms.',
        },
        response: {
          202: deletionBody,
          403: errorResponse(403, 'step_up_required'),
          404: errorResponse(404, 'user_not_found'),
          409: errorResponse(409, 'deletion_already_scheduled'),
        },
      },
    )
    .delete(
      '/deletion',
      async ({ auth, set }) => {
        await uc.cancelAccountDeletion.execute(auth)
        set.status = 204
      },
      {
        auth: true,
        detail: {
          summary: 'Cancel my account deletion',
          description: 'Possible only during the grace period.',
        },
        response: {
          204: t.Void({ description: 'Cancelled' }),
          404: errorResponse(404, 'no_deletion_scheduled'),
          409: errorResponse(409, 'deletion_in_progress'),
        },
      },
    )
