import cluster from 'node:cluster'
import { superviseProcesses } from '@kit/runtime'
import { createLogger, initTracing } from '@kit/telemetry'
import { buildApp } from '#/app'
import { loadAppConfig } from '#/bootstrap/config'
import { createContainer } from '#/bootstrap/container'

const config = loadAppConfig()
const { core } = config
const logger = createLogger(core.LOG_LEVEL)

// Cluster mode: the primary only supervises; every forked process re-runs this file and takes the path below.
if (core.APP_PROCESSES > 1 && cluster.isPrimary) {
  process.exit(await superviseProcesses(core.APP_PROCESSES, logger))
}

const tracing = config.telemetry.OTEL_EXPORTER_OTLP_ENDPOINT
  ? initTracing({
      serviceName: config.telemetry.OTEL_SERVICE_NAME,
      endpoint: config.telemetry.OTEL_EXPORTER_OTLP_ENDPOINT,
    })
  : null

const clustered = core.PROCESS_SLOT !== undefined
const container = await createContainer(config, logger)

// Before anything is served or pulled: a process started in the middle of a deploy comes up already in maintenance mode.
await container.maintenance.refresh()
container.maintenance.start()
if (container.maintenance.active) logger.warn('maintenance mode is on')

const app = core.APP_ROLES.includes('api')
  ? buildApp(container).listen({
      port: core.PORT,
      hostname: '0.0.0.0',
      // Lets the processes of a cluster bind the same port; the kernel spreads connections across them (Linux).
      reusePort: clustered,
    })
  : null
if (app) logger.info({ port: core.PORT, slot: core.PROCESS_SLOT }, 'api listening')

// Any number of worker-role processes is safe (SKIP LOCKED), but one per node is enough: in a cluster only slot 0 runs it.
if (core.APP_ROLES.includes('worker') && (!clustered || core.PROCESS_SLOT === 0)) {
  container.startWorker()
  logger.info(
    {
      outboxIntervalMs: config.outbox.OUTBOX_POLL_INTERVAL_MS,
      privacyJobsIntervalS: config.privacy.PRIVACY_JOBS_INTERVAL_SECONDS,
      paused: container.maintenance.active,
    },
    'outbox relay and privacy jobs started',
  )
}

let shuttingDown = false
async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  logger.info({ signal }, 'shutting down')
  // Order: close live SSE streams (else `stop` waits on them) → stop accepting requests (in-flight ones finish) →
  // stop the relay and the jobs (wait for the running batch) → close the DB pool.
  await container.closeLive()
  await app?.stop()
  await container.close()
  // Last, so the spans of the final relay batch and of in-flight requests are flushed too.
  await tracing?.shutdown()
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
