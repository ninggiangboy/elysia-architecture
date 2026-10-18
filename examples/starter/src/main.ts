import { createLogger, initTracing } from '@kit/telemetry'
import { buildApp } from './app'
import { loadAppConfig } from './bootstrap/config'
import { createContainer } from './bootstrap/container'

const config = loadAppConfig()
const { core } = config
const logger = createLogger(core.LOG_LEVEL)
const tracing = config.telemetry.OTEL_EXPORTER_OTLP_ENDPOINT
  ? initTracing({
      serviceName: config.telemetry.OTEL_SERVICE_NAME,
      endpoint: config.telemetry.OTEL_EXPORTER_OTLP_ENDPOINT,
    })
  : null

const container = await createContainer(config, logger)
await container.maintenance.refresh()
container.maintenance.start()

const app = core.APP_ROLES.includes('api')
  ? buildApp(container).listen({ port: core.PORT, hostname: '0.0.0.0' })
  : null
if (app) logger.info({ port: core.PORT }, 'api listening')
if (core.APP_ROLES.includes('worker')) container.startWorker()

let shuttingDown = false
async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  logger.info({ signal }, 'shutting down')
  await container.closeLive()
  await app?.stop()
  await container.close()
  await tracing?.shutdown()
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
