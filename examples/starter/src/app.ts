import { cors } from '@elysiajs/cors'
import {
  API_PREFIX,
  errorHandlerPlugin,
  maintenancePlugin,
  requestContextPlugin,
  tracingPlugin,
} from '@kit/http'
import { healthRoutes } from '@kit/runtime'
import { localStoragePlugin } from '@kit/storage/http'
import { Elysia } from 'elysia'
import type { Container } from './bootstrap/container'

export function buildApp(container: Container) {
  return (
    new Elysia({ prefix: API_PREFIX })
      .use(requestContextPlugin)
      .use(tracingPlugin)
      .use(errorHandlerPlugin(container.logger))
      .use(cors({ origin: container.config.core.CORS_ORIGINS, credentials: true }))
      .use(maintenancePlugin(container.maintenance))
      // Serves the links of STORAGE_DRIVER=local (answers 404 with any other storage).
      .use(localStoragePlugin(container.storage))
      .use(healthRoutes({ database: container.database, maintenance: container.maintenance }))
      // One static `.use()` per module: an Eden client infers its types from this chain.
      .use(container.modules.identity.routes)
      .use(container.modules.profile.routes)
    // <kit:routes>
  )
}

export type App = ReturnType<typeof buildApp>
