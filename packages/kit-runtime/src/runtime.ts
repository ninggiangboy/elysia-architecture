import type { Database } from '@kit/db'
import { InProcessMessageBus, type OutboxConfig, OutboxRelay } from '@kit/messaging'
import type { Logger } from '@kit/telemetry'
import type { AppModule } from './app-module'
import { MaintenanceMode, MaintenanceStore } from './maintenance-mode'

export interface RuntimeOptions {
  /** The installed modules, in install order. */
  modules: readonly AppModule[]
  database: Database
  logger: Logger
  /** The `outbox` slice of the configuration. */
  outbox: OutboxConfig
  /** The pool size: the relay keeps its parallelism below it. */
  dbPoolMax: number
  maintenance: {
    pollIntervalMs: number
    /** Replaces where the maintenance flag is read from (tests: no shared state with other processes on the database). */
    store?: Pick<MaintenanceStore, 'read'>
  }
}

/**
 * What runs the installed modules: the in-process bus with their handlers, the outbox relay over their outboxes, the
 * maintenance flag and the start/stop of their timers. The same for every app, whichever modules it installs.
 */
export function createRuntime({
  modules,
  database,
  logger,
  outbox,
  dbPoolMax,
  maintenance: m,
}: RuntimeOptions) {
  const jobs = modules.flatMap((module) => (module.jobs ? [module.jobs] : []))
  const docs = modules.flatMap((module) => module.docs ?? [])

  const bus = new InProcessMessageBus(logger)
  for (const handler of modules.flatMap((module) => module.handlers ?? [])) bus.subscribe(handler)

  const relay = new OutboxRelay(
    database,
    modules.flatMap((module) => (module.outbox ? [module.outbox] : [])),
    bus,
    logger,
    {
      pollIntervalMs: outbox.OUTBOX_POLL_INTERVAL_MS,
      batchSize: outbox.OUTBOX_BATCH_SIZE,
      concurrency: Math.min(outbox.OUTBOX_CONCURRENCY, Math.max(1, dbPoolMax - 2)),
      leaseSeconds: outbox.OUTBOX_LEASE_SECONDS,
      deferBudgetMs: outbox.OUTBOX_DEFER_BUDGET_HOURS * 3600_000,
    },
  )

  // Not started here (tests build containers too): `main.ts` reads it once before serving, then polls.
  const maintenance = new MaintenanceMode(
    m.store ?? new MaintenanceStore(database),
    logger,
    m.pollIntervalMs,
  )

  /** Maintenance mode stops everything that starts work on its own: the relay and the timers behind the jobs. */
  const pauseWorker = async () => {
    await relay.pause()
    for (const job of jobs) await job.stop()
  }
  const resumeWorker = () => {
    relay.resume()
    for (const job of jobs) job.start()
  }
  /** Closes what holds the HTTP server open (SSE streams). Idempotent; call it before stopping the server. */
  const closeLive = async () => {
    for (const module of modules) await module.close?.()
  }

  return {
    /** The API doc sections the modules describe. */
    docs,
    bus,
    relay,
    maintenance,
    /**
     * Starts what a worker-role process runs: the outbox relay, and the timers behind the modules' jobs.
     * Follows maintenance mode from then on: paused while it is on (right away if it already is), running again when it ends.
     */
    startWorker() {
      if (maintenance.active)
        void relay.pause() // before `start`, so the first batch is not claimed
      else for (const job of jobs) job.start()
      relay.start()
      // One transition at a time: on → off → on in quick succession must not interleave.
      let transition: Promise<unknown> = Promise.resolve()
      maintenance.onChange((active) => {
        transition = transition
          .then(active ? pauseWorker : resumeWorker)
          .catch((err) =>
            logger.error({ err, active }, 'switching the worker for maintenance failed'),
          )
      })
    },
    closeLive,
    async close() {
      maintenance.stop()
      for (const job of [...jobs].reverse()) await job.stop()
      await relay.stop()
      await closeLive()
      await database.close()
    },
  }
}

export type Runtime = ReturnType<typeof createRuntime>
