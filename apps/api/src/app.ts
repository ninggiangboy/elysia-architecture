import { cors } from '@elysiajs/cors'
import { openapi } from '@elysiajs/openapi'
import {
  API_PREFIX,
  errorHandlerPlugin,
  maintenancePlugin,
  openapiDocumentation,
  requestContextPlugin,
  tracingPlugin,
} from '@kit/http'
import { healthRoutes } from '@kit/runtime'
import { Elysia } from 'elysia'
import type { Container } from '#/bootstrap/container'

/** Shared by main.ts and e2e tests. `App` is the type the web app uses to infer the client (Eden Treaty). */
export function buildApp(container: Container) {
  return (
    new Elysia({ prefix: API_PREFIX })
      .use(requestContextPlugin)
      .use(tracingPlugin)
      .use(errorHandlerPlugin(container.logger))
      .use(cors({ origin: container.config.core.CORS_ORIGINS, credentials: true }))
      .use(maintenancePlugin(container.maintenance))
      .use(
        openapi({
          enabled: container.config.core.NODE_ENV === 'development',
          path: '/openapi',
          // By default the plugin excludes paths with a file extension (.json) — which would drop /.well-known/jwks.json from the docs.
          exclude: { staticFile: false },
          documentation: openapiDocumentation(container.docs),
        }),
      )
      .use(
        healthRoutes({
          database: container.database,
          // Add `{ name: 's3', ping }` here for every other dependency the app cannot serve without.
          checks: [],
          maintenance: container.maintenance,
        }),
      )
      // One static `.use()` per module on purpose: Eden Treaty infers the client types from this chain, and a loop over the
      // module list would turn them into `any`. `app.test.ts` fails when a module with routes is not mounted here.
      .use(container.modules.identity.routes)
      .use(container.modules.profile.routes)
      .use(container.modules.notification.routes)
      .use(container.modules.privacy.routes)
      .use(container.modules.billing.routes)
      .use(container.modules.realtime.routes)
  )
}

export type App = ReturnType<typeof buildApp>
