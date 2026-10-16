import cluster from 'node:cluster'
import { buildApp } from '#/app'
import { superviseWorkers } from '#/bootstrap/cluster'
import { createContainer } from '#/bootstrap/container'
import { loadConfig } from '#/shared/infrastructure/config'
import { createLogger } from '#/shared/infrastructure/logger'

const config = loadConfig()
const logger = createLogger(config.LOG_LEVEL)

// Cluster mode: the primary only supervises; every worker re-runs this file and takes the path below.
if (config.APP_WORKERS > 1 && cluster.isPrimary) {
  process.exit(await superviseWorkers(config.APP_WORKERS, logger))
}

const clustered = config.WORKER_SLOT !== undefined
const container = await createContainer(config, logger)

const app = config.APP_ROLES.includes('api')
  ? buildApp(container).listen({
      port: config.PORT,
      hostname: '0.0.0.0',
      // Lets the workers of a cluster bind the same port; the kernel spreads connections across them (Linux).
      reusePort: clustered,
    })
  : null
if (app) logger.info({ port: config.PORT, slot: config.WORKER_SLOT }, 'api listening')

// Any number of relays is safe (SKIP LOCKED), but one per node is enough: in a cluster only slot 0 runs it.
if (config.APP_ROLES.includes('relay') && (!clustered || config.WORKER_SLOT === 0)) {
  container.relay.start()
  logger.info({ intervalMs: config.OUTBOX_POLL_INTERVAL_MS }, 'outbox relay started')
}

let shuttingDown = false
async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  logger.info({ signal }, 'shutting down')
  // Order: close live SSE streams (else `stop` waits on them) → stop accepting requests →
  // stop the relay (wait for the running batch) → close the DB pool.
  await container.modules.realtime.stop()
  await app?.stop()
  await container.close()
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
