import { cors } from '@elysiajs/cors'
import { openapi } from '@elysiajs/openapi'
import { Elysia, t } from 'elysia'
import type { Container } from '#/bootstrap/container'
import { API_PREFIX } from '#/shared/http/constants'
import { errorHandlerPlugin } from '#/shared/http/error-handler.plugin'
import { maintenancePlugin } from '#/shared/http/maintenance.plugin'
import { openapiDocumentation } from '#/shared/http/openapi'
import { requestContextPlugin } from '#/shared/http/request-context.plugin'
import { tracingPlugin } from '#/shared/http/tracing.plugin'

const withTimeout = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ])

const readiness = t.Object({
  status: t.Union([t.Literal('ready'), t.Literal('degraded')]),
  database: t.Union([t.Literal('up'), t.Literal('down')]),
  /** True while maintenance mode is on: the process is healthy but answers every other request 503. */
  maintenance: t.Boolean(),
})

function healthRoutes(container: Container) {
  return new Elysia({ prefix: '/health', tags: ['health'] })
    .get('/live', () => ({ status: 'ok' as const }), {
      detail: {
        summary: 'Liveness',
        description: 'The process is alive. Does not check dependencies.',
      },
      response: { 200: t.Object({ status: t.Literal('ok') }) },
    })
    .get(
      '/ready',
      async ({ set }) => {
        const database = await withTimeout(container.database.ping(), 2000).then(
          () => 'up' as const,
          () => 'down' as const,
        )
        const ready = database === 'up'
        if (!ready) set.status = 503
        return {
          status: ready ? ('ready' as const) : ('degraded' as const),
          database,
          maintenance: container.maintenance.active,
        }
      },
      {
        detail: {
          summary: 'Readiness',
          description:
            'Checks the database connection; 503 if not ready. Stays ready in maintenance mode (and says so), so a deploy can tell a booted process from a dead one.',
        },
        response: {
          200: t.Object(readiness.properties, { description: 'Ready to accept requests' }),
          503: t.Object(readiness.properties, { description: 'Database is not responding' }),
        },
      },
    )
}

/** Shared by main.ts and e2e tests. `App` is the type the web app uses to infer the client (Eden Treaty). */
export function buildApp(container: Container) {
  return (
    new Elysia({ prefix: API_PREFIX })
      .use(requestContextPlugin)
      .use(tracingPlugin)
      .use(errorHandlerPlugin(container.logger))
      .use(cors({ origin: container.config.CORS_ORIGINS, credentials: true }))
      .use(maintenancePlugin(container.maintenance))
      .use(
        openapi({
          enabled: container.config.NODE_ENV === 'development',
          path: '/openapi',
          // By default the plugin excludes paths with a file extension (.json) — which would drop /.well-known/jwks.json from the docs.
          exclude: { staticFile: false },
          documentation: openapiDocumentation,
        }),
      )
      .use(healthRoutes(container))
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
