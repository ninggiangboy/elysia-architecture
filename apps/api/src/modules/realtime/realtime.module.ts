import type { Clock, Log } from '@kit/core'
import type { Database } from '@kit/db'
import type { TokenVerifier } from '#/shared/auth'
import type { IntegrationEventHandler } from '#/shared/messaging'
import type { AppModule } from '#/shared/runtime'
import { intervalJobs } from '#/shared/runtime'
import { PurgeUserEvents } from './application/handlers/purge-user-events'
import { RealtimePushHandler } from './application/handlers/realtime-push-handler'
import { SendTestEvent } from './application/use-cases/send-test-event'
import type { RealtimeConfig } from './config'
import type { RealtimeIntegration } from './contracts'
import { PgRealtimeHub } from './infrastructure/pg-realtime-hub'
import { realtimeRoutes } from './presentation/routes'

export interface RealtimeModuleDeps {
  database: Database
  clock: Clock
  log: Log
  verifier: TokenVerifier
  config: RealtimeConfig
  /** What reaches the user's open tabs: one entry per producer module the app installs. */
  integrations: readonly RealtimeIntegration[]
}

export interface RealtimeModule extends AppModule<'realtime', ReturnType<typeof realtimeRoutes>> {
  routes: ReturnType<typeof realtimeRoutes>
  handlers: IntegrationEventHandler[]
  /** Deletes replay-buffer events older than `olderThan`; returns how many. Runs on a timer (`jobs`), exposed for tests. */
  prune(olderThan: Date): Promise<number>
  /** Closes every live connection and stops listening. Called before the HTTP server is stopped. */
  close(): Promise<void>
}

const PRUNE_INTERVAL_MS = 60_000

/** Stateless-friendly live updates (SSE). Its only table is a short replay buffer; it otherwise just relays events to connected clients. */
export function createRealtimeModule(deps: RealtimeModuleDeps): RealtimeModule {
  const { database, clock, log, verifier, config } = deps
  const replayWindowMs = config.REALTIME_REPLAY_WINDOW_SECONDS * 1000
  const routes = deps.integrations.flatMap((i) => i.routes ?? [])
  const purges = deps.integrations.flatMap((i) => i.purgeOn ?? [])
  const hub = new PgRealtimeHub(database, clock, log)

  // Pruning is the worker's job: a process with only the api role does not run it.
  const jobs = intervalJobs({
    intervalMs: PRUNE_INTERVAL_MS,
    run: () => hub.prune(new Date(clock.now().getTime() - replayWindowMs)),
    onError: (err) => log.warn({ err }, 'pruning the realtime replay buffer failed'),
  })

  return {
    name: 'realtime',
    routes: realtimeRoutes({
      verifier,
      gateway: hub,
      useCases: { sendTestEvent: new SendTestEvent(hub) },
    }),
    handlers: [
      ...routes.map((r) => new RealtimePushHandler(r.name, r.eventType, r.map, hub, clock)),
      ...purges.map((r) => new PurgeUserEvents(r.name, r.eventType, r.userId, hub)),
    ],
    jobs,
    prune: (olderThan) => hub.prune(olderThan),
    close: () => hub.stop(),
  }
}
