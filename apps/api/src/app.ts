import { cors } from '@elysiajs/cors'
import { openapi } from '@elysiajs/openapi'
import { Elysia } from 'elysia'
import type { Container } from '#/bootstrap/container'
import { API_PREFIX } from '#/shared/http/constants'
import { errorHandlerPlugin } from '#/shared/http/error-handler.plugin'
import { requestContextPlugin } from '#/shared/http/request-context.plugin'

const withTimeout = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ])

function healthRoutes(container: Container) {
  return new Elysia({ prefix: '/health', tags: ['health'] })
    .get('/live', () => ({ status: 'ok' as const }))
    .get('/ready', async ({ set }) => {
      const database = await withTimeout(container.database.ping(), 2000).then(
        () => 'up' as const,
        () => 'down' as const,
      )
      const ready = database === 'up'
      if (!ready) set.status = 503
      return {
        status: ready ? ('ready' as const) : ('degraded' as const),
        database,
      }
    })
}

/** Dùng chung cho main.ts và e2e test. `App` là type để web suy ra client (Eden Treaty). */
export function buildApp(container: Container) {
  return new Elysia({ prefix: API_PREFIX })
    .use(requestContextPlugin)
    .use(errorHandlerPlugin(container.logger))
    .use(cors({ origin: container.config.CORS_ORIGINS, credentials: true }))
    .use(
      openapi({
        path: '/openapi',
        documentation: { info: { title: 'Elysia Architecture API', version: '0.1.0' } },
      }),
    )
    .use(healthRoutes(container))
    .use(container.modules.identity.routes)
    .use(container.modules.profile.routes)
}

export type App = ReturnType<typeof buildApp>
