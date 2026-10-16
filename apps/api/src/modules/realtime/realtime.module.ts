import { IdentityEvents, type SessionRevokedPayload } from '#/modules/identity/contracts'
import {
  type NotificationCreatedPayload,
  NotificationEvents,
  type NotificationReadPayload,
} from '#/modules/notification/contracts'
import type { Clock, IdGenerator, IntegrationEventHandler, Log } from '#/shared/application/ports'
import type { TokenVerifier } from '#/shared/http/auth.plugin'
import type { Database } from '#/shared/infrastructure/db/database'
import { RealtimePushHandler } from './application/handlers/realtime-push-handler'
import { SendTestEvent } from './application/use-cases/send-test-event'
import { PgRealtimeHub } from './infrastructure/pg-realtime-hub'
import { realtimeRoutes } from './presentation/routes'

export interface RealtimeModuleDeps {
  database: Database
  clock: Clock
  ids: IdGenerator
  log: Log
  verifier: TokenVerifier
}

export interface RealtimeModule {
  name: 'realtime'
  routes: ReturnType<typeof realtimeRoutes>
  handlers: IntegrationEventHandler[]
  /** Closes every live connection and stops listening. Call before stopping the HTTP server. */
  stop(): Promise<void>
}

/** Stateless-friendly live updates (SSE). Owns no tables: it only relays events to connected clients. */
export function createRealtimeModule(deps: RealtimeModuleDeps): RealtimeModule {
  const { database, clock, ids, log, verifier } = deps
  const hub = new PgRealtimeHub(database.client, ids, clock, log)

  return {
    name: 'realtime',
    routes: realtimeRoutes({
      verifier,
      gateway: hub,
      useCases: { sendTestEvent: new SendTestEvent(hub) },
    }),
    handlers: [
      new RealtimePushHandler<SessionRevokedPayload>(
        'realtime.push-session-revoked',
        IdentityEvents.SessionRevoked,
        (p) => ({
          userId: p.userId,
          closeSessionId: p.sessionId,
          event: {
            type: 'session.revoked',
            data: { sessionId: p.sessionId, reason: p.reason, revokedAt: p.revokedAt },
          },
        }),
        hub,
        clock,
      ),
      new RealtimePushHandler<NotificationCreatedPayload>(
        'realtime.push-notification-created',
        NotificationEvents.Created,
        (p) => ({
          userId: p.userId,
          event: {
            type: 'notification.created',
            data: {
              id: p.notificationId,
              kind: p.kind,
              title: p.title,
              body: p.body,
              data: p.data,
              createdAt: p.createdAt,
            },
          },
        }),
        hub,
        clock,
      ),
      new RealtimePushHandler<NotificationReadPayload>(
        'realtime.push-notification-read',
        NotificationEvents.Read,
        (p) => ({
          userId: p.userId,
          event: {
            type: 'notification.read',
            data: { id: p.notificationId, readAt: p.readAt },
          },
        }),
        hub,
        clock,
      ),
    ],
    stop: () => hub.stop(),
  }
}
