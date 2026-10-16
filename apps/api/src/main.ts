import { buildApp } from '#/app'
import { createContainer } from '#/bootstrap/container'
import { loadConfig } from '#/shared/infrastructure/config'
import { createLogger } from '#/shared/infrastructure/logger'

const config = loadConfig()
const logger = createLogger(config.LOG_LEVEL)
const container = await createContainer(config, logger)

const app = config.APP_ROLES.includes('api')
  ? buildApp(container).listen({ port: config.PORT, hostname: '0.0.0.0' })
  : null
if (app) logger.info({ port: config.PORT }, 'api listening')

if (config.APP_ROLES.includes('relay')) {
  container.relay.start()
  logger.info({ intervalMs: config.OUTBOX_POLL_INTERVAL_MS }, 'outbox relay started')
}

let shuttingDown = false
async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  logger.info({ signal }, 'shutting down')
  // Order: stop accepting requests → stop the relay (wait for the running batch) → close the DB pool.
  await app?.stop()
  await container.close()
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
