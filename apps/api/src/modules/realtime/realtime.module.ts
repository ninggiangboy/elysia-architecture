import { IdentityEvents, type SessionRevokedPayload } from '#/modules/identity/contracts'
import {
  type NotificationCreatedPayload,
  NotificationEvents,
  type NotificationReadPayload,
  type NotificationSeenPayload,
} from '#/modules/notification/contracts'
import type { Clock, IntegrationEventHandler, Log } from '#/shared/application/ports'
import type { TokenVerifier } from '#/shared/http/auth.plugin'
import type { Database } from '#/shared/infrastructure/db/database'
import { RealtimePushHandler } from './application/handlers/realtime-push-handler'
import { SendTestEvent } from './application/use-cases/send-test-event'
import { PgRealtimeHub } from './infrastructure/pg-realtime-hub'
import { realtimeRoutes } from './presentation/routes'

export interface RealtimeModuleDeps {
  database: Database
  clock: Clock
  log: Log
  verifier: TokenVerifier
  /** How long a client can be disconnected and still replay what it missed via `Last-Event-ID`. */
  replayWindowMs: number
}

export interface RealtimeModule {
  name: 'realtime'
  routes: ReturnType<typeof realtimeRoutes>
  handlers: IntegrationEventHandler[]
  /** Deletes replay-buffer events older than `olderThan`; returns how many. Runs on a timer, exposed for tests. */
  prune(olderThan: Date): Promise<number>
  /** Closes every live connection, stops listening and stops pruning. Call before stopping the HTTP server. */
  stop(): Promise<void>
}

const PRUNE_INTERVAL_MS = 60_000

/** Stateless-friendly live updates (SSE). Its only table is a short replay buffer; it otherwise just relays events to connected clients. */
export function createRealtimeModule(deps: RealtimeModuleDeps): RealtimeModule {
  const { database, clock, log, verifier, replayWindowMs } = deps
  const hub = new PgRealtimeHub(database, clock, log)

  const prune = () =>
    hub
      .prune(new Date(clock.now().getTime() - replayWindowMs))
      .catch((err) => log.warn({ err }, 'pruning the realtime replay buffer failed'))
  const pruneTimer = setInterval(prune, PRUNE_INTERVAL_MS)
  pruneTimer.unref()

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
            // A device that was offline when it was signed out must learn it on reconnect, not when its token expires.
            replay: true,
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
      new RealtimePushHandler<NotificationSeenPayload>(
        'realtime.push-notification-seen',
        NotificationEvents.Seen,
        (p) => ({
          userId: p.userId,
          event: { type: 'notification.seen', data: { seenAt: p.seenAt } },
        }),
        hub,
        clock,
      ),
    ],
    prune: (olderThan) => hub.prune(olderThan),
    async stop() {
      clearInterval(pruneTimer)
      await hub.stop()
    },
  }
}
