import { cors } from '@elysiajs/cors'
import { openapi } from '@elysiajs/openapi'
import { Elysia, t } from 'elysia'
import type { Container } from '#/bootstrap/container'
import { API_PREFIX } from '#/shared/http/constants'
import { errorHandlerPlugin } from '#/shared/http/error-handler.plugin'
import { openapiDocumentation } from '#/shared/http/openapi'
import { requestContextPlugin } from '#/shared/http/request-context.plugin'

const withTimeout = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ])

const readiness = t.Object({
  status: t.Union([t.Literal('ready'), t.Literal('degraded')]),
  database: t.Union([t.Literal('up'), t.Literal('down')]),
})

function healthRoutes(container: Container) {
  return new Elysia({ prefix: '/health', tags: ['health'] })
    .get('/live', () => ({ status: 'ok' as const }), {
      detail: { summary: 'Liveness', description: 'Process còn sống. Không kiểm tra phụ thuộc.' },
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
        }
      },
      {
        detail: {
          summary: 'Readiness',
          description: 'Kiểm tra kết nối database; 503 nếu chưa sẵn sàng.',
        },
        response: {
          200: t.Object(readiness.properties, { description: 'Sẵn sàng nhận request' }),
          503: t.Object(readiness.properties, { description: 'Database không phản hồi' }),
        },
      },
    )
}

/** Dùng chung cho main.ts và e2e test. `App` là type để web suy ra client (Eden Treaty). */
export function buildApp(container: Container) {
  return new Elysia({ prefix: API_PREFIX })
    .use(requestContextPlugin)
    .use(errorHandlerPlugin(container.logger))
    .use(cors({ origin: container.config.CORS_ORIGINS, credentials: true }))
    .use(
      openapi({
        enabled: container.config.NODE_ENV === 'development',
        path: '/openapi',
        // Mặc định plugin loại đường dẫn có đuôi file (.json) — sẽ làm mất /.well-known/jwks.json khỏi docs.
        exclude: { staticFile: false },
        documentation: openapiDocumentation,
      }),
    )
    .use(healthRoutes(container))
    .use(container.modules.identity.routes)
    .use(container.modules.profile.routes)
}

export type App = ReturnType<typeof buildApp>
