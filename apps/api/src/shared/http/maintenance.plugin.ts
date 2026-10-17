import { Elysia } from 'elysia'
import { requestContext } from '#/shared/infrastructure/request-context'
import { API_PREFIX } from './constants'

const HEALTH_PREFIX = `${API_PREFIX}/health/`

/**
 * While maintenance mode is on, every request but the health probes is answered 503 + `Retry-After` before it reaches a
 * route, so nothing new starts while the process drains. Mount it after CORS: the browser must still be able to read the 503.
 * Callers that retry (Stripe's webhooks, the web client) simply come back after the deploy.
 */
export const maintenancePlugin = (mode: { readonly active: boolean }, retryAfterSeconds = 30) =>
  new Elysia({ name: 'maintenance' }).onRequest(({ request, set }) => {
    if (!mode.active) return
    if (new URL(request.url).pathname.startsWith(HEALTH_PREFIX)) return
    set.status = 503
    set.headers['retry-after'] = String(retryAfterSeconds)
    set.headers['cache-control'] = 'no-store'
    return {
      error: {
        code: 'maintenance',
        message: 'The service is being updated, please try again in a moment',
        requestId: requestContext.get()?.requestId,
      },
    }
  })
